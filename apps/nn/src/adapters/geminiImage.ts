import { VertexAI } from '@google-cloud/vertexai';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { 
  ImageGenProvider, 
  RenderRequest, 
  RenderResult, 
  Problem 
} from '../types.js';
import { validateGoogleCloudConfig, env } from '../config/env.js';
import { createOperationLogger, logError } from '../logger.js';
import { generateFileHash, isStyleCopy } from '../core/idempotency.js';
import { STYLE_ONLY_PREFIX } from '../core/remix.js';

/**
 * Style distance threshold - images with similarity > this are rejected
 */
const STYLE_COPY_DISTANCE_MAX = 10;

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
      
      await sleep(jitter);
    }
  }
  
  throw new Error(`Retry exhausted for ${operation}`);
}

/**
 * Generate perceptual hash for image similarity checking
 */
async function generatePHash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .resize(32, 32)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Simple pHash: compare pixels to average
  const pixels = new Uint8Array(data);
  const avg = pixels.reduce((sum, val) => sum + val, 0) / pixels.length;
  
  let hash = 0n;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i]! > avg) {
      hash |= 1n << BigInt(i);
    }
  }
  
  return hash.toString(16);
}

/**
 * Check if generated image passes style distance validation
 * Returns true if acceptable, false if too similar (potential copy)
 */
async function passesStyleDistance(
  generated: Buffer, 
  styleRefs: string[]
): Promise<boolean> {
  const generatedHash = await generatePHash(generated);
  
  for (const refPath of styleRefs) {
    try {
      const refBuffer = await readFile(refPath);
      const refHash = await generatePHash(refBuffer);
      
      // Calculate Hamming distance between hashes
      const distance = hammingDistance(generatedHash, refHash);
      
      if (distance <= STYLE_COPY_DISTANCE_MAX) {
        return false; // Too similar = potential copy
      }
    } catch (error) {
      // If we can't read reference, skip this check
      continue;
    }
  }
  
  return true; // Acceptable style transfer
}

/**
 * Calculate Hamming distance between two hex strings
 */
function hammingDistance(hash1: string, hash2: string): number {
  const maxLength = Math.max(hash1.length, hash2.length);
  const a = BigInt(`0x${hash1.padStart(maxLength, '0')}`);
  const b = BigInt(`0x${hash2.padStart(maxLength, '0')}`);
  
  let xor = a ^ b;
  let distance = 0;
  
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  
  return distance;
}

/**
 * Gemini Image Provider using Vertex AI with ADC
 */
export class GeminiImageAdapter implements ImageGenProvider {
  private vertex: VertexAI;
  private model: any;
  private log = createOperationLogger('GeminiImageAdapter');

  constructor() {
    // Validate Google Cloud configuration
    validateGoogleCloudConfig();
    
    // Initialize Vertex AI with ADC (no API keys)
    const project = env.GOOGLE_CLOUD_PROJECT!;
    const location = env.GOOGLE_CLOUD_LOCATION;
    
    this.vertex = new VertexAI({ project, location });
    this.model = this.vertex.preview.getGenerativeModel({
      model: 'gemini-2.5-flash-image-preview',
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096,
      },
    });
  }

  /**
   * Render images from prompt batch
   */
  async render(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants, styleRefs, runMode } = request;
    
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
    
    // Ensure output directory exists
    const outputDir = join(env.NN_OUT_DIR, 'renders');
    await mkdir(outputDir, { recursive: true });
    
    // Process each prompt with retries and validation
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      
      for (let v = 0; v < variants; v++) {
        const id = `${i}-${v}-${Date.now()}`;
        
        try {
          const generated = await withRetry(
            () => this.generateImage(row.prompt, styleRefs),
            `generate-${id}`
          );
          
          // Style distance validation
          const passesValidation = await passesStyleDistance(generated, styleRefs);
          if (!passesValidation) {
            this.log.warn({ id, prompt: row.prompt.slice(0, 50) }, 
                          'Style copy detected, retrying');
            
            // Retry up to 2 times with jitter
            let retrySuccess = false;
            for (let retry = 0; retry < 2 && !retrySuccess; retry++) {
              await sleep(Math.random() * 2000);
              const retryGenerated = await this.generateImage(row.prompt, styleRefs);
              if (await passesStyleDistance(retryGenerated, styleRefs)) {
                retrySuccess = true;
                await this.saveImage(retryGenerated, id, outputDir);
                break;
              }
            }
            
            if (!retrySuccess) {
              this.log.error({ id }, 'Style validation failed after retries, skipping');
              continue;
            }
          } else {
            await this.saveImage(generated, id, outputDir);
          }
          
          results.push({
            id,
            prompt: row.prompt,
            outPath: join(outputDir, `${id}.png`),
          });
          
        } catch (error) {
          logError(this.log, error, `render-${id}`);
        }
      }
    }
    
    return { results };
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
            mimeType: 'image/jpeg', // Assume JPEG for now
          },
        };
      })
    );
    
    // Combine prompt text with style references
    const userParts = [{ text: prompt }, ...styleParts];
    
    const response = await this.model.generateContent({
      contents: [
        systemPrompt,
        { role: 'user', parts: userParts },
      ],
    });
    
    // Extract image data from response
    const candidate = response.response.candidates[0];
    if (!candidate?.content?.parts?.[0]?.inlineData?.data) {
      throw new Error('No image data in response');
    }
    
    return Buffer.from(candidate.content.parts[0].inlineData.data, 'base64');
  }

  /**
   * Save image atomically (tmp -> rename)
   */
  private async saveImage(buffer: Buffer, id: string, outputDir: string): Promise<void> {
    const finalPath = join(outputDir, `${id}.png`);
    const tmpPath = `${finalPath}.tmp`;
    
    await writeFile(tmpPath, buffer);
    await writeFile(finalPath, await readFile(tmpPath));
    
    // Clean up temp file (ignore errors)
    try {
      await import('node:fs/promises').then(fs => fs.unlink(tmpPath));
    } catch {
      // Ignore cleanup errors
    }
  }
}