import type { 
  ImageGenProvider, 
  AsyncImageGenProvider, 
  PromptRow, 
  RenderResult 
} from '../types.js';
import { env } from '../config/env.js';
import { createOperationLogger } from '../logger.js';
import { GeminiBatchAdapter } from './geminiBatch.js';
import { GeminiImageAdapter } from './geminiImage.js';
import { MockImageAdapter } from './mockImage.js';

const log = createOperationLogger('ProviderFactory');

/**
 * Unified provider interface that abstracts async/sync differences
 * Batch (async): submit → poll → fetch
 * Vertex (sync): render directly  
 */
export interface UnifiedProvider {
  /**
   * Generate images - handles both async batch and sync direct rendering
   * For batch: submits job and returns job info for polling
   * For sync: renders immediately and returns results
   */
  generate(req: {
    rows: PromptRow[];
    variants: 1 | 2 | 3;
    styleOnly: boolean;
    styleRefs: string[];
    runMode: 'dry_run' | 'live';
  }): Promise<GenerateResult>;
}

/**
 * Unified result that handles both batch job info and direct results
 */
export type GenerateResult = 
  | { type: 'batch_job'; jobId: string; estCount: number }
  | { type: 'direct_result'; result: RenderResult };

/**
 * Batch provider wrapper - converts async API to unified interface
 */
class BatchProviderWrapper implements UnifiedProvider {
  constructor(private adapter: AsyncImageGenProvider) {}
  
  async generate(req: {
    rows: PromptRow[];
    variants: 1 | 2 | 3;
    styleOnly: boolean;
    styleRefs: string[];
    runMode: 'dry_run' | 'live';
  }): Promise<GenerateResult> {
    const estCount = req.rows.length * req.variants;
    
    // Cost estimation and guardrails
    const estimatedCostUSD = env.NN_PRICE_PER_IMAGE_USD ? 
      estCount * env.NN_PRICE_PER_IMAGE_USD : undefined;
      
    // Warn for large batches
    if (estCount > 100) {
      log.warn({ 
        estCount, 
        estimatedCostUSD 
      }, 'Large batch detected - consider splitting for better reliability');
    }
    
    if (req.runMode === 'dry_run') {
      // For dry runs, estimate without submitting
      log.info({ 
        estCount, 
        rows: req.rows.length, 
        variants: req.variants,
        estimatedCostUSD 
      }, 'Batch dry-run estimation');
      
      return {
        type: 'batch_job',
        jobId: `dry-run-${Date.now()}`,
        estCount
      };
    }
    
    // Live batch submission
    const job = await this.adapter.submit({
      rows: req.rows,
      variants: req.variants,
      styleOnly: true, // Always enforce style-only
      styleRefs: req.styleRefs
    });
    
    log.info({ jobId: job.jobId, estCount: job.estCount }, 'Batch job submitted');
    
    return {
      type: 'batch_job',
      jobId: job.jobId,
      estCount: job.estCount
    };
  }
}

/**
 * Sync provider wrapper - converts sync API to unified interface  
 */
class SyncProviderWrapper implements UnifiedProvider {
  constructor(private adapter: ImageGenProvider) {}
  
  async generate(req: {
    rows: PromptRow[];
    variants: 1 | 2 | 3;
    styleOnly: boolean;
    styleRefs: string[];
    runMode: 'dry_run' | 'live';
  }): Promise<GenerateResult> {
    // Use existing sync render interface
    const result = await this.adapter.render({
      rows: req.rows,
      variants: req.variants,
      styleOnly: req.styleOnly,
      styleRefs: req.styleRefs,
      runMode: req.runMode
    });
    
    log.info({ 
      resultCount: result.results.length, 
      runMode: req.runMode 
    }, 'Sync render completed');
    
    return {
      type: 'direct_result',
      result
    };
  }
}

/**
 * Provider factory - creates unified provider based on configuration
 * Priority: batch (default) → vertex (fallback) → mock (testing)
 */
export function createProvider(): UnifiedProvider {
  const provider = env.NN_PROVIDER;
  
  log.info({ provider }, 'Creating provider');
  
  switch (provider) {
    case 'batch':
      log.info('Using Gemini Batch (async) provider');
      return new BatchProviderWrapper(new GeminiBatchAdapter());
      
    case 'vertex':
      if (!env.GOOGLE_CLOUD_PROJECT) {
        throw new Error('GOOGLE_CLOUD_PROJECT is required for vertex provider');
      }
      log.info('Using Vertex AI (sync fallback) provider');
      return new SyncProviderWrapper(new GeminiImageAdapter({
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION
      }));
      
    case 'mock':
      log.info('Using Mock (testing) provider');
      return new SyncProviderWrapper(new MockImageAdapter());
      
    default:
      log.warn({ provider }, 'Unknown provider, defaulting to batch');
      return new BatchProviderWrapper(new GeminiBatchAdapter());
  }
}

/**
 * Helper: Check if result is a batch job (needs polling)
 */
export function isBatchJob(result: GenerateResult): result is { type: 'batch_job'; jobId: string; estCount: number } {
  return result.type === 'batch_job';
}

/**
 * Helper: Check if result is direct (completed immediately)
 */
export function isDirectResult(result: GenerateResult): result is { type: 'direct_result'; result: RenderResult } {
  return result.type === 'direct_result';
}

/**
 * Convenience function for workflows - handles provider selection automatically
 */
export async function generateImages(req: {
  rows: PromptRow[];
  variants: 1 | 2 | 3;
  styleOnly: boolean;
  styleRefs: string[];
  runMode: 'dry_run' | 'live';
}): Promise<GenerateResult> {
  const provider = createProvider();
  return provider.generate(req);
}