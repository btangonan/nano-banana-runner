import { createHash } from 'node:crypto';
import { createOperationLogger, logTiming } from '../../logger.js';
import type { 
  AnalyzeProvider, 
  ImageDescriptor, 
  ProviderConfig, 
  CostEstimate,
  ProviderMetrics
} from './types.js';

/**
 * Configuration for Gemini provider
 */
interface GeminiProviderConfig extends ProviderConfig {
  proxyUrl: string;
  model: string;
  chunkSize: number;
}

/**
 * Response from proxy /analyze/describe endpoint
 */
interface ProxyResponse {
  descriptor?: ImageDescriptor;
  costEstimate?: CostEstimate;
  error?: {
    type: string;
    title: string;
    detail?: string;
    status: number;
    retryable: boolean;
    costIncurred: number;
  };
}

/**
 * Gemini-powered analyze provider implementation
 * Uses secure proxy for API calls with chunking and retry logic
 */
export class GeminiProvider implements AnalyzeProvider {
  readonly name = 'gemini' as const;
  readonly config: GeminiProviderConfig;
  private metrics: ProviderMetrics;
  private log = createOperationLogger('GeminiProvider');

  constructor(config: Partial<GeminiProviderConfig> = {}) {
    this.config = {
      maxImagesPerBatch: 64,
      timeoutMs: 30000,
      retries: 3,
      backoffMs: [200, 400, 800],
      costPerImage: 0.0025, // Gemini 1.5 Pro Vision base rate
      proxyUrl: process.env['BATCH_PROXY_URL'] || 'http://127.0.0.1:8787',
      model: 'gemini-1.5-pro-vision-latest',
      chunkSize: 16, // Process max 16 images per chunk
      ...config,
    };
    
    this.metrics = {
      requestsTotal: 0,
      failuresTotal: 0,
      rateLimitedTotal: 0,
      latencyHistogram: [],
      costTotal: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Detect MIME type from buffer
   */
  private detectMimeType(buffer: Buffer): string {
    // Check PNG signature
    if (buffer.length >= 8 && 
        buffer[0] === 0x89 && buffer[1] === 0x50 && 
        buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    
    // Check JPEG signature
    if (buffer.length >= 3 && 
        buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    
    // Check WebP signature
    if (buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
    
    return 'image/jpeg'; // Default fallback
  }

  /**
   * Call proxy endpoint with retry logic
   */
  private async callProxy(
    imageBuffer: Buffer, 
    _path: string,
    dryRun: boolean = false
  ): Promise<ProxyResponse> {
    const base64Image = imageBuffer.toString('base64');
    const mimeType = this.detectMimeType(imageBuffer);
    
    const requestBody = {
      image: base64Image,
      mimeType,
      dryRun,
    };
    
    const url = `${this.config.proxyUrl}/analyze/describe`;
    
    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          
          // Handle specific error types
          if (response.status === 429) {
            this.metrics.rateLimitedTotal++;
            if (errorData.retryable && attempt < this.config.retries - 1) {
              await this.sleep(this.config.backoffMs[attempt] || 800);
              continue;
            }
          }
          
          throw new Error(`HTTP ${response.status}: ${errorData.title || 'Unknown error'}`);
        }
        
        return await response.json() as ProxyResponse;
        
      } catch (error) {
        if (attempt === this.config.retries - 1) {
          throw error; // Last attempt, propagate error
        }
        
        // Wait before retry
        await this.sleep(this.config.backoffMs[attempt] || 800);
      }
    }
    
    throw new Error('Max retries exceeded');
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Analyze a single image using Gemini Vision API
   */
  async analyze(_path: string, buffer: Buffer): Promise<ImageDescriptor> {
    const startTime = Date.now();
    this.metrics.requestsTotal++;
    
    try {
      this.log.debug({ path: _path, size: buffer.length }, 'Starting Gemini analysis');
      
      // Call proxy endpoint
      const response = await this.callProxy(buffer, _path, false);
      
      if (response.error) {
        this.metrics.failuresTotal++;
        this.metrics.costTotal += response.error.costIncurred || 0;
        
        throw new Error(`Gemini API error: ${response.error.title} - ${response.error.detail || ''}`);
      }
      
      if (!response.descriptor) {
        throw new Error('No descriptor in response');
      }
      
      // Update descriptor with client-side info
      const descriptor: ImageDescriptor = {
        ...response.descriptor,
        path: _path,
        hash: createHash('sha256').update(buffer).digest('hex'),
      };
      
      // Record metrics
      const latency = Date.now() - startTime;
      this.metrics.latencyHistogram.push(latency);
      this.metrics.costTotal += this.config.costPerImage;
      
      logTiming(this.log, 'GeminiProvider.analyze', startTime);
      
      return descriptor;
      
    } catch (error) {
      this.metrics.failuresTotal++;
      this.log.error({ error, path: _path }, 'Gemini analysis failed');
      
      // Return partial descriptor with error
      return {
        provider: 'gemini',
        path: _path,
        hash: createHash('sha256').update(buffer).digest('hex'),
        width: 1,
        height: 1,
        format: 'unknown',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Batch analyze multiple images with chunking and concurrency control
   */
  async analyzeBatch(items: Array<{path: string, buffer: Buffer}>): Promise<ImageDescriptor[]> {
    const log = createOperationLogger('GeminiProvider.analyzeBatch', { count: items.length });
    const startTime = Date.now();
    
    if (items.length > this.config.maxImagesPerBatch) {
      throw new Error(`Batch size ${items.length} exceeds limit ${this.config.maxImagesPerBatch}`);
    }
    
    // Split into chunks for processing
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += this.config.chunkSize) {
      chunks.push(items.slice(i, i + this.config.chunkSize));
    }
    
    log.info({ chunks: chunks.length, chunkSize: this.config.chunkSize }, 'Processing batch in chunks');
    
    const results: ImageDescriptor[] = [];
    
    // Process chunks sequentially to respect rate limits
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;
      log.debug({ chunkIndex, chunkSize: chunk.length }, 'Processing chunk');
      
      // Process items in chunk concurrently (but limited by chunk size)
      const chunkPromises = chunk.map(item => this.analyze(item.path, item.buffer));
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      
      // Small delay between chunks to be nice to the API
      if (chunkIndex < chunks.length - 1) {
        await this.sleep(100);
      }
    }
    
    logTiming(log, 'GeminiProvider.analyzeBatch', startTime);
    log.info({ 
      total: items.length, 
      successful: results.filter(r => !r.errors).length,
      chunks: chunks.length,
    }, 'Batch analysis complete');
    
    return results;
  }

  /**
   * Estimate cost for analyzing images (dry-run)
   */
  async estimateCost(imageCount: number): Promise<CostEstimate> {
    // For accurate estimation, we could call proxy with dryRun=true
    // But for simplicity, use base calculation
    const baseCost = imageCount * this.config.costPerImage;
    const estimatedTimeMs = imageCount * 2000; // ~2s per image
    
    return {
      imageCount,
      estimatedCost: baseCost,
      estimatedTimeMs,
      provider: 'gemini',
    };
  }

  /**
   * Validate Gemini provider configuration and proxy connectivity
   */
  async validateConfig(): Promise<boolean> {
    try {
      // Test with a minimal 1x1 PNG
      const testBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
        0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      
      // Test dry-run call to proxy
      const response = await this.callProxy(testBuffer, 'test.png', true);
      
      return !!response.costEstimate && response.costEstimate.provider === 'gemini';
      
    } catch (error) {
      this.log.error({ error }, 'Gemini provider validation failed');
      return false;
    }
  }

  /**
   * Get current provider metrics
   */
  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset provider metrics
   */
  resetMetrics(): void {
    this.metrics = {
      requestsTotal: 0,
      failuresTotal: 0,
      rateLimitedTotal: 0,
      latencyHistogram: [],
      costTotal: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Get detailed cost breakdown
   */
  getCostBreakdown(): {
    totalCost: number;
    avgCostPerImage: number;
    totalImages: number;
    estimatedMonthlyCost: number;
  } {
    const totalImages = this.metrics.requestsTotal - this.metrics.failuresTotal;
    const avgCostPerImage = totalImages > 0 ? this.metrics.costTotal / totalImages : 0;
    
    return {
      totalCost: this.metrics.costTotal,
      avgCostPerImage,
      totalImages,
      estimatedMonthlyCost: this.metrics.costTotal * 30, // Rough monthly projection
    };
  }

  /**
   * Clean up provider resources
   */
  async cleanup(): Promise<void> {
    // No persistent connections or resources to clean up
    this.log.info('Gemini provider cleanup complete');
  }
}