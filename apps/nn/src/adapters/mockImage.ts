import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { 
  ImageGenProvider, 
  RenderRequest, 
  RenderResult 
} from '../types.js';
import { env } from '../config/env.js';
import { createOperationLogger } from '../logger.js';
import { sha256 } from '../core/idempotency.js';

/**
 * Configuration for mock image generation
 */
interface MockConfig {
  delay?: number;           // Simulate API latency (ms)
  failureRate?: number;     // Probability of failure (0-1)
  width?: number;           // Generated image width
  height?: number;          // Generated image height
}

/**
 * Simple hash function for deterministic colors
 */
function hashToColor(input: string, seed: number = 0): [number, number, number] {
  const hash = sha256(input + seed);
  const r = parseInt(hash.slice(0, 2), 16);
  const g = parseInt(hash.slice(2, 4), 16);
  const b = parseInt(hash.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Generate deterministic pattern based on prompt
 */
async function generatePattern(
  prompt: string,
  width: number,
  height: number,
  seed: number = 0
): Promise<Buffer> {
  // Create base color from prompt
  const [r, g, b] = hashToColor(prompt, seed);
  
  // Create a gradient pattern
  const pixels = new Uint8Array(width * height * 3);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      
      // Create gradient effect
      const gradientX = x / width;
      const gradientY = y / height;
      
      // Mix colors based on position and prompt hash
      const mixR = Math.floor(r * (1 - gradientX) + (255 - r) * gradientX);
      const mixG = Math.floor(g * (1 - gradientY) + (255 - g) * gradientY);
      const mixB = Math.floor(b * (gradientX + gradientY) / 2);
      
      pixels[i] = mixR;
      pixels[i + 1] = mixG;
      pixels[i + 2] = mixB;
    }
  }
  
  // Convert to PNG buffer
  return sharp(pixels, { 
    raw: { width, height, channels: 3 } 
  })
    .png()
    .toBuffer();
}

/**
 * Mock Image Provider for testing
 */
export class MockImageAdapter implements ImageGenProvider {
  private config: MockConfig;
  private log = createOperationLogger('MockImageAdapter');

  constructor(config: MockConfig = {}) {
    this.config = {
      delay: 100,        // Fast by default for tests
      failureRate: 0,    // No failures by default
      width: 512,
      height: 512,
      ...config,
    };
  }

  /**
   * Render mock images from prompt batch
   */
  async render(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants, runMode } = request;
    
    if (runMode === 'dry_run') {
      return this.estimateCost(request);
    }
    
    return this.executeRender(request);
  }

  /**
   * Estimate cost for dry-run
   */
  private async estimateCost(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants } = request;
    const imageCount = rows.length * variants;
    const concurrency = Math.min(4, Math.ceil(imageCount / 10));
    const estimatedTime = Math.ceil(imageCount / concurrency) * 0.1; // 100ms per image
    
    // Mock pricing
    const pricePerImage = Number(env.NN_PRICE_PER_IMAGE_USD ?? 0.001);
    const estimatedCost = imageCount * pricePerImage;
    
    this.log.info({
      imageCount,
      estimatedCost,
      estimatedTime,
    }, 'Mock cost estimation');
    
    return {
      results: [],
      costPlan: {
        imageCount,
        estimatedCost,
        estimatedTime: `${estimatedTime}s`,
      },
    };
  }

  /**
   * Execute mock render
   */
  private async executeRender(request: RenderRequest): Promise<RenderResult> {
    const { rows, variants } = request;
    const results: Array<{ id: string; prompt: string; outPath: string }> = [];
    
    // Ensure output directory exists
    const outputDir = join(env.NN_OUT_DIR, 'renders');
    await mkdir(outputDir, { recursive: true });
    
    // Process each prompt
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      
      for (let v = 0; v < variants; v++) {
        const id = `mock-${i}-${v}-${Date.now()}`;
        
        try {
          // Simulate API delay
          if (this.config.delay && this.config.delay > 0) {
            await this.sleep(this.config.delay);
          }
          
          // Simulate occasional failures
          if (this.config.failureRate && Math.random() < this.config.failureRate) {
            throw new Error('Simulated API failure');
          }
          
          // Generate deterministic image
          const imageBuffer = await generatePattern(
            row.prompt,
            this.config.width!,
            this.config.height!,
            row.seed || v
          );
          
          // Save atomically
          const finalPath = join(outputDir, `${id}.png`);
          await this.saveImageAtomic(imageBuffer, finalPath);
          
          results.push({
            id,
            prompt: row.prompt,
            outPath: finalPath,
          });
          
          this.log.debug({ id, prompt: row.prompt.slice(0, 50) }, 'Mock image generated');
          
        } catch (error) {
          this.log.error({ id, error }, 'Mock generation failed');
        }
      }
    }
    
    this.log.info({ 
      requested: rows.length * variants,
      generated: results.length 
    }, 'Mock render complete');
    
    return { results };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save image atomically (tmp -> rename)
   */
  private async saveImageAtomic(buffer: Buffer, finalPath: string): Promise<void> {
    const tmpPath = `${finalPath}.tmp`;
    
    try {
      await writeFile(tmpPath, buffer);
      
      // Atomic rename (on most filesystems)
      const { rename } = await import('node:fs/promises');
      await rename(tmpPath, finalPath);
      
    } catch (error) {
      // Clean up temp file on error
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Configure mock behavior
   */
  configure(config: Partial<MockConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset to default configuration
   */
  reset(): void {
    this.config = {
      delay: 100,
      failureRate: 0,
      width: 512,
      height: 512,
    };
  }
}