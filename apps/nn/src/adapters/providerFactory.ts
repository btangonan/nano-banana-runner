import type { 
  ImageGenProvider, 
  AsyncImageGenProvider, 
  PromptRow, 
  RenderResult,
  ProviderName
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
 * Provider factory - creates unified provider based on configuration with per-job override support
 * Priority: per-job override → env default → batch (fallback)
 */
export function createProvider(providerOverride?: ProviderName): UnifiedProvider {
  const defaultProvider = (env.NN_PROVIDER === 'vertex' ? 'vertex' : 'batch') as ProviderName;
  const chosen = providerOverride ?? defaultProvider;
  
  log.info({ chosen, defaultProvider, override: providerOverride }, 'Creating provider with override support');
  
  switch (chosen) {
    case 'batch':
      log.info('Using Gemini Batch (async) provider');
      return new BatchProviderWrapper(new GeminiBatchAdapter());
      
    case 'vertex':
      if (!env.GOOGLE_CLOUD_PROJECT) {
        const err: any = {
          type: 'about:blank',
          title: 'Vertex provider requires ADC configuration',
          detail: 'GOOGLE_CLOUD_PROJECT is required for vertex provider. Configure ADC or use --provider batch',
          status: 400
        };
        throw Object.assign(new Error(err.detail), err);
      }
      log.info('Using Vertex AI (sync fallback) provider');
      return new SyncProviderWrapper(new GeminiImageAdapter({
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION
      }));
      
    default:
      const err: any = {
        type: 'about:blank',
        title: 'Unknown provider',
        detail: `provider=${String(chosen)}. Must be 'batch' or 'vertex'`,
        status: 400
      };
      throw Object.assign(new Error(err.detail), err);
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
 * Convenience function for workflows - handles provider selection automatically with override support
 */
export async function generateImages(req: {
  rows: PromptRow[];
  variants: 1 | 2 | 3;
  styleOnly: boolean;
  styleRefs: string[];
  runMode: 'dry_run' | 'live';
  provider?: ProviderName;  // per-job override
}): Promise<GenerateResult> {
  const provider = createProvider(req.provider);
  return provider.generate(req);
}