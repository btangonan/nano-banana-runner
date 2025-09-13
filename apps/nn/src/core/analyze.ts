import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ImageDescriptor } from '../types.js';
import { createOperationLogger, logTiming } from '../logger.js';
import { env } from '../config/env.js';
import { createAnalyzeProvider } from './providers/factory.js';
import type { AnalyzeProvider, ProviderFactoryConfig } from './providers/types.js';

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Check if file is a supported image format
 */
export function isSupportedImage(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return SUPPORTED_FORMATS.has(ext);
}

/**
 * Create and cache the analyze provider based on environment configuration
 * This ensures consistent provider usage across all analyze operations
 */
let cachedProvider: AnalyzeProvider | null = null;

function getProvider(): AnalyzeProvider {
  if (!cachedProvider) {
    const config: ProviderFactoryConfig = {
      provider: env.NN_ANALYZE_PROVIDER,
      killSwitch: env.NN_ANALYZE_KILL_SWITCH,
      cacheEnabled: env.NN_ANALYZE_CACHE_ENABLED,
      maxCacheSize: env.NN_ANALYZE_CACHE_MAX_SIZE,
      diskCacheEnabled: env.NN_ANALYZE_DISK_CACHE,
      rolloutPercent: env.NN_ANALYZE_ROLLOUT_PERCENT,
    };
    
    cachedProvider = createAnalyzeProvider(config);
    
    const log = createOperationLogger('analyze', { provider: cachedProvider.name });
    log.info({ 
      provider: cachedProvider.name,
      cacheEnabled: config.cacheEnabled,
      rolloutPercent: config.rolloutPercent,
    }, 'Analyze provider initialized');
  }
  
  return cachedProvider;
}

/**
 * Analyze a single image and extract descriptor
 * 
 * This function maintains backward compatibility while delegating to the
 * configured provider (Sharp by default, Gemini when opted-in)
 */
export async function analyzeImage(path: string): Promise<ImageDescriptor> {
  const log = createOperationLogger('analyzeImage', { path });
  const startTime = Date.now();
  
  try {
    if (!isSupportedImage(path)) {
      throw new Error(`Unsupported image format: ${extname(path)}`);
    }
    
    // Read file buffer
    const buffer = await readFile(path);
    
    // Get provider and analyze
    const provider = getProvider();
    const descriptor = await provider.analyze(path, buffer);
    
    logTiming(log, 'analyzeImage', startTime);
    return descriptor;
    
  } catch (error) {
    log.error({ error }, 'Failed to analyze image');
    
    // Return partial descriptor with error (maintains backward compatibility)
    return {
      path,
      hash: '',
      width: 1,
      height: 1,
      palette: [],
      subjects: [],
      style: [],
      lighting: 'unknown',
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Batch analyze multiple images with concurrency control
 * 
 * This function maintains backward compatibility while delegating to the
 * configured provider's batch processing capabilities
 */
export async function analyzeImages(
  paths: string[],
  concurrency: number = 4
): Promise<ImageDescriptor[]> {
  const log = createOperationLogger('analyzeImages', { count: paths.length });
  const startTime = Date.now();
  
  try {
    // Filter supported images
    const supportedPaths = paths.filter(isSupportedImage);
    
    if (supportedPaths.length < paths.length) {
      log.warn({ 
        total: paths.length, 
        supported: supportedPaths.length 
      }, 'Some images have unsupported formats');
    }
    
    // Read all file buffers
    const items = await Promise.all(
      supportedPaths.map(async (path) => ({
        path,
        buffer: await readFile(path),
      }))
    );
    
    // Get provider and batch analyze
    const provider = getProvider();
    
    // If provider doesn't have specific concurrency handling, use its batch method
    // The provider implementation will handle concurrency internally
    const results = await provider.analyzeBatch(items);
    
    logTiming(log, 'analyzeImages', startTime);
    log.info({ 
      total: paths.length, 
      successful: results.filter(r => !r.errors).length,
      provider: provider.name,
    }, 'Batch analysis complete');
    
    return results;
    
  } catch (error) {
    log.error({ error }, 'Batch analysis failed');
    
    // Fallback: analyze images individually
    const results: ImageDescriptor[] = [];
    const queue = [...paths];
    const inProgress = new Set<Promise<void>>();
    
    while (queue.length > 0 || inProgress.size > 0) {
      // Start new tasks up to concurrency limit
      while (queue.length > 0 && inProgress.size < concurrency) {
        const path = queue.shift()!;
        const task = analyzeImage(path).then(descriptor => {
          results.push(descriptor);
          inProgress.delete(task);
        });
        inProgress.add(task);
      }
      
      // Wait for at least one task to complete
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }
    
    return results;
  }
}

/**
 * Reset the cached provider (useful for testing)
 */
export function resetProvider(): void {
  cachedProvider = null;
}

/**
 * Get the current provider name (useful for debugging and testing)
 */
export function getCurrentProviderName(): string {
  const provider = getProvider();
  return provider.name;
}