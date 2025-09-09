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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const log = createOperationLogger('ProviderFactory');

interface ProbeCache {
  timestamp: string;
  project: string;
  location: string;
  results: Array<{
    model: string;
    status: 'healthy' | 'degraded' | 'error';
    http: number;
    code?: string;
  }>;
}

/**
 * Read probe cache if available
 */
async function readProbeCache(): Promise<ProbeCache | null> {
  const cachePath = join(env.NN_OUT_DIR, 'artifacts', 'probe', 'publishers.json');
  try {
    const content = await readFile(cachePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log.debug({ cachePath }, 'No probe cache found');
    return null;
  }
}

/**
 * Check if a model is healthy based on probe cache
 */
function isModelHealthy(cache: ProbeCache | null, modelName: string): boolean {
  if (!cache) return true; // No cache means assume healthy
  
  const result = cache.results.find(r => r.model === modelName);
  if (!result) return true; // Model not in cache, assume healthy
  
  return result.status === 'healthy';
}

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
 * Priority: per-job override → env default → batch (default)
 * Auto-fallback: Vertex unavailable → Batch (unless noFallback is true)
 * Model health gating: Uses probe cache to gate unhealthy models
 * DEFAULT: Batch provider unless explicitly set to vertex
 */
export async function createProvider(providerOverride?: ProviderName, noFallback?: boolean): Promise<UnifiedProvider> {
  // Default to 'batch' unless explicitly set to 'vertex'
  const defaultProvider = (env.NN_PROVIDER === 'vertex' ? 'vertex' : 'batch') as ProviderName;
  const chosen = providerOverride ?? defaultProvider;
  
  log.info({ 
    chosen, 
    defaultProvider, 
    override: providerOverride, 
    noFallback,
    provider: chosen  // Always log the actual provider being used
  }, 'Creating provider with override support');
  
  switch (chosen) {
    case 'batch':
      log.info('Using Gemini Batch (async) provider');
      return new BatchProviderWrapper(new GeminiBatchAdapter());
      
    case 'vertex':
      if (!env.GOOGLE_CLOUD_PROJECT) {
        if (noFallback) {
          const err: any = {
            type: 'about:blank',
            title: 'Vertex AI configuration missing',
            detail: 'GOOGLE_CLOUD_PROJECT is required for Vertex AI provider',
            status: 400
          };
          throw Object.assign(new Error(err.detail), err);
        }
        log.warn({ 
          reason: 'missing_project_config',
          fallback: 'batch' 
        }, 'Vertex requires GOOGLE_CLOUD_PROJECT, falling back to batch');
        return new BatchProviderWrapper(new GeminiBatchAdapter());
      }
      
      // Check probe cache for model health
      const cache = await readProbeCache();
      const primaryModel = 'gemini-1.5-flash'; // Primary model to check
      
      // Check if primary model is healthy based on probe cache
      if (cache && !isModelHealthy(cache, primaryModel)) {
        log.warn({ 
          model: primaryModel, 
          cache: cache.timestamp 
        }, 'Primary model marked unhealthy in probe cache');
        
        if (noFallback) {
          const modelResult = cache.results.find(r => r.model === primaryModel);
          const err: any = {
            type: 'about:blank',
            title: 'Model entitlement missing',
            detail: `Publisher Model ${primaryModel} is not available (status: ${modelResult?.status}, HTTP: ${modelResult?.http})`,
            status: 403,
            instance: modelResult?.model,
            extensions: {
              probeTimestamp: cache.timestamp,
              modelStatus: modelResult?.status,
              httpCode: modelResult?.http
            }
          };
          throw Object.assign(new Error(err.detail), err);
        }
        
        log.info({ 
          reason: 'model_unhealthy',
          model: primaryModel,
          fallback: 'batch' 
        }, 'Auto-fallback to Batch provider due to unhealthy model');
        return new BatchProviderWrapper(new GeminiBatchAdapter());
      }
      
      // Create Vertex adapter and probe availability
      const vertexAdapter = new GeminiImageAdapter({
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION
      });
      
      // Probe Vertex availability with automatic fallback
      log.info('Probing Vertex AI availability');
      const isAvailable = await vertexAdapter.probe();
      
      if (isAvailable) {
        log.info('Using Vertex AI (sync) provider - probe successful');
        return new SyncProviderWrapper(vertexAdapter);
      } else {
        if (noFallback) {
          const err: any = {
            type: 'about:blank',
            title: 'Vertex AI unavailable',
            detail: 'Vertex AI probe failed - entitlement or authentication issue',
            status: 503
          };
          throw Object.assign(new Error(err.detail), err);
        }
        log.warn({ 
          reason: 'vertex_probe_failed',
          fallback: 'batch' 
        }, 'Vertex AI unavailable (entitlement/auth issue), falling back to Batch provider');
        return new BatchProviderWrapper(new GeminiBatchAdapter());
      }
      
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
 * Synchronous provider factory for backwards compatibility
 * Warning: Does not probe Vertex availability
 */
export function createProviderSync(providerOverride?: ProviderName): UnifiedProvider {
  const defaultProvider = (env.NN_PROVIDER === 'vertex' ? 'vertex' : 'batch') as ProviderName;
  const chosen = providerOverride ?? defaultProvider;
  
  log.info({ chosen, defaultProvider, override: providerOverride }, 'Creating provider (sync, no probe)');
  
  switch (chosen) {
    case 'batch':
      log.info('Using Gemini Batch (async) provider');
      return new BatchProviderWrapper(new GeminiBatchAdapter());
      
    case 'vertex':
      if (!env.GOOGLE_CLOUD_PROJECT) {
        log.warn('Vertex requires GOOGLE_CLOUD_PROJECT, falling back to batch');
        return new BatchProviderWrapper(new GeminiBatchAdapter());
      }
      log.info('Using Vertex AI (sync) provider - no probe');
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
 * Includes automatic probe and fallback for Vertex
 */
export async function generateImages(req: {
  rows: PromptRow[];
  variants: 1 | 2 | 3;
  styleOnly: boolean;
  styleRefs: string[];
  runMode: 'dry_run' | 'live';
  provider?: ProviderName;  // per-job override
  noFallback?: boolean;     // prevent automatic fallback
}): Promise<GenerateResult> {
  const provider = await createProvider(req.provider, req.noFallback);
  return provider.generate(req);
}