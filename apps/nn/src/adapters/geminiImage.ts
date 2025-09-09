import { VertexAI } from '@google-cloud/vertexai';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
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
 * Save HTML error response for debugging
 */
async function saveHtmlErrorArtifact(content: string, errorType: string): Promise<string> {
  const log = createOperationLogger('saveHtmlErrorArtifact');
  const errorDir = join(env.NN_OUT_DIR, 'artifacts', 'errors');
  
  try {
    await mkdir(errorDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vertex_${errorType}_${timestamp}.html`;
    const filepath = join(errorDir, filename);
    
    // Save first 512 bytes for analysis
    const truncated = content.slice(0, 512);
    await writeFile(filepath, truncated, 'utf-8');
    
    log.info({ filepath, size: truncated.length }, 'Saved HTML error artifact');
    return filepath;
  } catch (err) {
    log.error({ error: err }, 'Failed to save HTML error artifact');
    return '';
  }
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
  private lastProbeTime: number = 0;
  private lastProbeResult: boolean = false;
  private readonly PROBE_CACHE_MS = 5 * 60 * 1000; // 5 minutes
  
  constructor(config: GeminiAdapterConfig) {
    
    // Initialize Vertex AI with ADC (no API keys)
    this.vertex = new VertexAI({ 
      project: config.project, 
      location: config.location 
    });
    
    this.model = this.vertex.getGenerativeModel({
      model: 'gemini-1.5-flash',
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
   * Probe Vertex AI availability with cached results
   */
  async probe(): Promise<boolean> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.lastProbeTime && (now - this.lastProbeTime) < this.PROBE_CACHE_MS) {
      this.log.debug({ 
        cached: true, 
        result: this.lastProbeResult,
        cacheAge: Math.round((now - this.lastProbeTime) / 1000) 
      }, 'Returning cached probe result');
      return this.lastProbeResult;
    }
    
    try {
      // Simple probe: test prompt without images
      const probeRequest = {
        contents: [{
          role: 'user',
          parts: [{ text: 'Respond with OK' }]
        }]
      };
      
      this.log.debug('Probing Vertex AI availability');
      
      const response = await this.model.generateContent(probeRequest);
      
      // Check if we got a valid response
      const hasValidResponse = response?.response?.candidates?.length > 0;
      
      // Cache successful result
      this.lastProbeTime = now;
      this.lastProbeResult = hasValidResponse;
      
      this.log.info({ 
        available: hasValidResponse,
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION
      }, 'Vertex AI probe completed');
      
      return hasValidResponse;
      
    } catch (error: any) {
      // Cache failed result
      this.lastProbeTime = now;
      this.lastProbeResult = false;
      
      // Log specific error type
      if (error?.status === 404 || error?.message?.includes('NOT_FOUND')) {
        this.log.warn({ 
          error: 'Model entitlement required',
          project: env.GOOGLE_CLOUD_PROJECT
        }, 'Vertex AI probe failed - model not accessible');
      } else if (error?.status === 403) {
        this.log.warn({ 
          error: 'Permission denied',
          project: env.GOOGLE_CLOUD_PROJECT
        }, 'Vertex AI probe failed - IAM permissions');
      } else {
        this.log.warn({ 
          error: error?.message || 'Unknown error',
          status: error?.status
        }, 'Vertex AI probe failed');
      }
      
      return false;
    }
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
    try {
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
    } catch (error: any) {
      // Check if the error response is HTML (non-JSON)
      if (error?.response && typeof error.response === 'string') {
        const responseStr = error.response.toString();
        
        // Detect HTML response
        if (responseStr.includes('<!DOCTYPE') || responseStr.includes('<html')) {
          // Save HTML artifact for debugging
          const artifactPath = await saveHtmlErrorArtifact(responseStr, 'html_error');
          
          const problemError = {
            type: 'urn:vertex:html-error-response',
            title: 'Non-JSON Error Response',
            detail: 'Vertex AI returned HTML error page instead of JSON. This typically indicates a service outage or authentication issue.',
            status: 503,
            instance: crypto.randomUUID(),
            meta: {
              project: env.GOOGLE_CLOUD_PROJECT,
              location: env.GOOGLE_CLOUD_LOCATION,
              artifactPath,
              firstBytes: responseStr.slice(0, 100)
            }
          };
          this.log.error(problemError, 'Vertex AI returned HTML error - service issue detected');
          throw problemError;
        }
      }
      
      // Handle specific Vertex AI errors
      if (error?.status === 404 || error?.message?.includes('NOT_FOUND')) {
        // Check if error message indicates model not found
        const isModelNotFound = error?.message?.includes('Publisher Model') || 
                                error?.message?.includes('was not found');
        
        const problemError = {
          type: isModelNotFound ? 'urn:vertex:model-entitlement' : 'urn:vertex:model-not-found',
          title: isModelNotFound ? 'Model Entitlement Required' : 'Model Not Found',
          detail: isModelNotFound 
            ? `Project ${env.GOOGLE_CLOUD_PROJECT} lacks entitlement to Gemini models in ${env.GOOGLE_CLOUD_LOCATION}. Contact Google Cloud support to enable access.`
            : `Model not available in ${env.GOOGLE_CLOUD_LOCATION} for project ${env.GOOGLE_CLOUD_PROJECT}`,
          status: 404,
          instance: crypto.randomUUID(),
          meta: {
            project: env.GOOGLE_CLOUD_PROJECT,
            location: env.GOOGLE_CLOUD_LOCATION,
            model: 'gemini-1.5-flash',
            action: isModelNotFound ? 'Request entitlement from Google Cloud support' : 'Check model availability'
          }
        };
        this.log.error(problemError, 'Vertex AI model not accessible - falling back to batch');
        throw problemError;
      }
      
      if (error?.status === 403 || error?.message?.includes('PERMISSION_DENIED')) {
        const problemError = {
          type: 'urn:vertex:permission-denied',
          title: 'Permission Denied',
          detail: `IAM permission denied for Vertex AI in project ${env.GOOGLE_CLOUD_PROJECT}`,
          status: 403,
          instance: crypto.randomUUID(),
          meta: {
            project: env.GOOGLE_CLOUD_PROJECT,
            location: env.GOOGLE_CLOUD_LOCATION,
            requiredRole: 'roles/aiplatform.user'
          }
        };
        this.log.error(problemError, 'Vertex AI permission denied - falling back to batch');
        throw problemError;
      }
      
      // Handle rate limiting
      if (error?.status === 429 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        const problemError = {
          type: 'urn:vertex:rate-limit',
          title: 'Rate Limit Exceeded',
          detail: 'Vertex AI rate limit exceeded. Reduce concurrency or wait before retrying.',
          status: 429,
          instance: crypto.randomUUID(),
          meta: {
            project: env.GOOGLE_CLOUD_PROJECT,
            location: env.GOOGLE_CLOUD_LOCATION,
            suggestion: 'Reduce NN_MAX_CONCURRENCY to 1 or 2'
          }
        };
        this.log.warn(problemError, 'Vertex AI rate limit hit');
        throw problemError;
      }
      
      // Handle service unavailable
      if (error?.status === 503 || error?.message?.includes('SERVICE_UNAVAILABLE')) {
        const problemError = {
          type: 'urn:vertex:service-unavailable',
          title: 'Service Temporarily Unavailable',
          detail: 'Vertex AI service is temporarily unavailable. Please try again later.',
          status: 503,
          instance: crypto.randomUUID(),
          meta: {
            project: env.GOOGLE_CLOUD_PROJECT,
            location: env.GOOGLE_CLOUD_LOCATION
          }
        };
        this.log.warn(problemError, 'Vertex AI service unavailable');
        throw problemError;
      }
      
      // Re-throw other errors with enhanced context
      if (error?.status || error?.code) {
        const problemError = {
          type: 'urn:vertex:api-error',
          title: 'Vertex AI API Error',
          detail: error?.message || 'Unknown error occurred',
          status: error?.status || 500,
          instance: crypto.randomUUID(),
          meta: {
            project: env.GOOGLE_CLOUD_PROJECT,
            location: env.GOOGLE_CLOUD_LOCATION,
            errorCode: error?.code,
            originalError: error?.message
          }
        };
        this.log.error(problemError, 'Vertex AI API error');
        throw problemError;
      }
      
      // Re-throw unknown errors
      throw error;
    }
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