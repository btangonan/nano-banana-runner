import { VertexAI } from '@google-cloud/vertexai';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { 
  ImageGenProvider, 
  RenderRequest, 
  RenderResult
} from '../types.js';
import { env } from '../config/env.js';
import { createOperationLogger, logError } from '../logger.js';
// Remove unused import
import { STYLE_ONLY_PREFIX } from '../core/remix.js';
import { 
  extractFirstImageBase64, 
  toPngBufferFromB64, 
  isBlockedResponse,
  getBlockReason 
} from './vertexResponse.js';
import { passesStyleGuard } from '../core/styleGuard.js';
import { tapRequestResponse } from '../lib/debugTap.js';

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncated exponential backoff with full jitter
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  const log = createOperationLogger('withRetry');
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries - 1;
      
      // Don't retry on non-retryable errors
      if (error.status && error.status < 500 && error.status !== 429) {
        throw error;
      }
      
      if (isLastAttempt) {
        throw error;
      }
      
      // Calculate backoff with full jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
      const jitter = Math.random() * delay;
      
      log.debug({ 
        operation, 
        attempt: attempt + 1, 
        maxRetries, 
        jitterMs: Math.round(jitter) 
      }, 'Retrying with backoff');
      
      await sleep(jitter);
    }
  }
  
  throw new Error(`Retry exhausted for ${operation}`);
}

interface GeminiAdapterConfig {
  project: string;
  location: string;
}

/**
 * Gemini Image Provider using Vertex AI with ADC
 */
export class GeminiImageAdapter implements ImageGenProvider {
  private vertex: VertexAI;
  private model: any;
  private log = createOperationLogger('GeminiImageAdapter');
  constructor(config: GeminiAdapterConfig) {
    
    // Initialize Vertex AI with ADC (no API keys)
    this.vertex = new VertexAI({ 
      project: config.project, 
      location: config.location 
    });
    
    this.model = this.vertex.preview.getGenerativeModel({
      model: 'gemini-2.5-flash-image-preview',
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096,
      },
    });
    
    this.log.info({ 
      project: config.project, 
      location: config.location 
    }, 'Initialized Gemini adapter');
  }

  /**
   * Render images from prompt batch
   */
  async render(request: RenderRequest): Promise<RenderResult> {
    const { runMode } = request;
    
    if (runMode === 'dry_run') {
      return this.estimateCost(request);
    }
    
    return this.executeRender(request);
  }

  /**
   * Estimate cost without making API calls
   */
  private async estimateCost(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants } = request;
    const imageCount = rows.length * variants;
    const concurrency = Math.min(4, Math.ceil(imageCount / 10));
    const estimatedTime = Math.ceil(imageCount / concurrency) * 3; // 3s per image avg
    
    // Configurable pricing from environment
    const pricePerImage = Number(env.NN_PRICE_PER_IMAGE_USD ?? NaN);
    const estimatedCost = Number.isFinite(pricePerImage) 
      ? imageCount * pricePerImage 
      : undefined;
    
    return {
      results: [],
      costPlan: {
        imageCount,
        estimatedCost: estimatedCost ?? 0,
        estimatedTime: `${estimatedTime}s`,
      },
    };
  }

  /**
   * Execute live render with retry and style validation
   */
  private async executeRender(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants, styleRefs } = request;
    const results: Array<{ id: string; prompt: string; outPath: string }> = [];
    
    // Determine concurrency level
    const totalImages = rows.length * variants;
    const maxConcurrency = Math.min(
      Number(env.NN_MAX_CONCURRENCY ?? 2),
      4,  // Hard cap at 4 concurrent requests
      Math.ceil(totalImages / 3)  // Scale with workload
    );
    
    this.log.info({ 
      totalImages, 
      concurrency: maxConcurrency 
    }, 'Starting batch generation');
    
    // Ensure output directory exists
    const outputDir = join(env.NN_OUT_DIR, 'renders');
    await mkdir(outputDir, { recursive: true });
    
    // Load style reference buffers for validation
    const styleRefBuffers = await Promise.all(
      styleRefs.map(path => readFile(path))
    );
    
    // Create work items
    const workItems: Array<{ row: any; variant: number; index: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      for (let v = 0; v < variants; v++) {
        workItems.push({ row: rows[i]!, variant: v, index: i });
      }
    }
    
    // Process with controlled concurrency
    const inProgress = new Set<Promise<void>>();
    
    for (const item of workItems) {
      // Wait if we're at max concurrency
      if (inProgress.size >= maxConcurrency) {
        await Promise.race(inProgress);
      }
      
      // Start new work item
      const work = this.processWorkItem(
        item,
        styleRefs,
        styleRefBuffers,
        outputDir,
        results
      ).finally(() => {
        inProgress.delete(work);
      });
      
      inProgress.add(work);
    }
    
    // Wait for all remaining work
    await Promise.all(inProgress);
    
    this.log.info({ 
      completed: results.length, 
      total: totalImages 
    }, 'Batch generation complete');
    
    return { results };
  }
  
  /**
   * Process a single work item (prompt + variant)
   */
  private async processWorkItem(
    item: { row: any; variant: number; index: number },
    styleRefs: string[],
    styleRefBuffers: Buffer[],
    outputDir: string,
    results: Array<{ id: string; prompt: string; outPath: string }>
  ): Promise<void> {
    const id = `${item.index}-${item.variant}-${Date.now()}`;
    
    try {
      const generated = await withRetry(
        () => this.generateImage(item.row.prompt, styleRefs),
        `generate-${id}`
      );
      
      // Style guard validation
      const passesValidation = await passesStyleGuard(
        generated, 
        styleRefBuffers
      );
      
      if (!passesValidation) {
        this.log.warn({ id, prompt: item.row.prompt.slice(0, 50) }, 
                      'Style copy detected, retrying');
        
        // Retry with jitter
        let retrySuccess = false;
        for (let retry = 0; retry < 2 && !retrySuccess; retry++) {
          await sleep(Math.random() * 2000);
          const retryGenerated = await this.generateImage(item.row.prompt, styleRefs);
          if (await passesStyleGuard(retryGenerated, styleRefBuffers)) {
            retrySuccess = true;
            await this.saveImage(retryGenerated, id, outputDir);
            break;
          }
        }
        
        if (!retrySuccess) {
          this.log.error({ id }, 'Style validation failed after retries, skipping');
          return;
        }
      } else {
        await this.saveImage(generated, id, outputDir);
      }
      
      results.push({
        id,
        prompt: item.row.prompt,
        outPath: join(outputDir, `${id}.png`),
      });
      
    } catch (error) {
      logError(this.log, error, `render-${id}`);
    }
  }

  /**
   * Generate single image with style-only conditioning
   */
  private async generateImage(prompt: string, styleRefs: string[]): Promise<Buffer> {
    // Layer 1: System prompt with style-only instruction
    const systemPrompt = {
      role: 'system',
      parts: [{ text: STYLE_ONLY_PREFIX }],
    };
    
    // Layer 2: Attach style references as multimodal parts
    const styleParts = await Promise.all(
      styleRefs.map(async (refPath) => {
        const buffer = await readFile(refPath);
        return {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType: 'image/png',
          },
        };
      })
    );
    
    // Combine prompt text with style references
    const userParts = [{ text: prompt }, ...styleParts];
    
    const request = {
      contents: [
        systemPrompt,
        { role: 'user', parts: userParts },
      ],
    };
    
    // Tap request if debug is enabled
    await tapRequestResponse(request, null, 'generate-image');
    
    // Make the API call
    const response = await this.model.generateContent(request);
    
    // Tap response if debug is enabled
    await tapRequestResponse(null, response, 'generate-image');
    
    // Check if response was blocked
    if (isBlockedResponse(response.response)) {
      const reason = getBlockReason(response.response);
      throw new Error(`Generation blocked: ${reason || 'Unknown reason'}`);
    }
    
    // Extract image data using new parser
    const imageBase64 = extractFirstImageBase64(response.response);
    if (!imageBase64) {
      throw new Error('No image data in response');
    }
    
    // Convert to PNG buffer
    return toPngBufferFromB64(imageBase64);
  }

  /**
   * Save image atomically (tmp -> rename)
   */
  private async saveImage(buffer: Buffer, id: string, outputDir: string): Promise<void> {
    const finalPath = join(outputDir, `${id}.png`);
    const tmpPath = `${finalPath}.tmp`;
    
    // Write to temp file
    await writeFile(tmpPath, buffer);
    
    // Atomically rename to final path
    await rename(tmpPath, finalPath);
    
    this.log.debug({ 
      id, 
      size: buffer.length, 
      path: finalPath 
    }, 'Saved image atomically');
  }
}