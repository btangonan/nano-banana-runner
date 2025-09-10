import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createOperationLogger } from '../../logger.js';
import type { 
  AnalyzeProvider, 
  ProviderFactoryConfig, 
  ImageDescriptor,
  CostEstimate
} from './types.js';
import { SharpProvider } from './sharp.js';

/**
 * LRU Cache implementation for in-memory caching
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 256) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Cached provider wrapper with disk and memory caching
 */
class CachedProvider implements AnalyzeProvider {
  private provider: AnalyzeProvider;
  private memoryCache: LRUCache<string, ImageDescriptor>;
  private diskCacheEnabled: boolean;
  private cacheDir: string;
  private log = createOperationLogger('CachedProvider');

  constructor(
    provider: AnalyzeProvider,
    config: { maxCacheSize: number; diskCacheEnabled: boolean; cacheDir?: string }
  ) {
    this.provider = provider;
    this.memoryCache = new LRUCache(config.maxCacheSize);
    this.diskCacheEnabled = config.diskCacheEnabled;
    this.cacheDir = config.cacheDir || 'artifacts/cache/analyze';
  }

  get name() { return this.provider.name; }
  get config() { return this.provider.config; }

  /**
   * Generate cache key from buffer hash
   */
  private getCacheKey(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Get disk cache path for hash
   */
  private getDiskCachePath(hash: string): string {
    return join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Load descriptor from disk cache
   */
  private async loadFromDisk(hash: string): Promise<ImageDescriptor | null> {
    if (!this.diskCacheEnabled) return null;
    
    try {
      const cachePath = this.getDiskCachePath(hash);
      const content = await readFile(cachePath, 'utf8');
      return JSON.parse(content) as ImageDescriptor;
    } catch {
      return null;
    }
  }

  /**
   * Save descriptor to disk cache
   */
  private async saveToDisk(hash: string, descriptor: ImageDescriptor): Promise<void> {
    if (!this.diskCacheEnabled || descriptor.errors) return;
    
    try {
      const cachePath = this.getDiskCachePath(hash);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(descriptor, null, 2));
    } catch (error) {
      this.log.warn({ error, hash }, 'Failed to save to disk cache');
    }
  }

  async analyze(path: string, buffer: Buffer): Promise<ImageDescriptor> {
    const cacheKey = this.getCacheKey(buffer);
    
    // Check memory cache first
    const memoryResult = this.memoryCache.get(cacheKey);
    if (memoryResult) {
      this.log.debug({ path, cacheKey }, 'Memory cache hit');
      return memoryResult;
    }
    
    // Check disk cache
    const diskResult = await this.loadFromDisk(cacheKey);
    if (diskResult) {
      this.log.debug({ path, cacheKey }, 'Disk cache hit');
      this.memoryCache.set(cacheKey, diskResult);
      return diskResult;
    }
    
    // Cache miss - analyze with provider
    this.log.debug({ path, cacheKey }, 'Cache miss - analyzing');
    const result = await this.provider.analyze(path, buffer);
    
    // Cache successful results
    if (!result.errors) {
      this.memoryCache.set(cacheKey, result);
      await this.saveToDisk(cacheKey, result);
    }
    
    return result;
  }

  async analyzeBatch(items: Array<{path: string, buffer: Buffer}>): Promise<ImageDescriptor[]> {
    const results: ImageDescriptor[] = [];
    
    // Process each item individually to leverage caching
    for (const item of items) {
      const result = await this.analyze(item.path, item.buffer);
      results.push(result);
    }
    
    return results;
  }

  async estimateCost(imageCount: number): Promise<CostEstimate> {
    return this.provider.estimateCost(imageCount);
  }

  async validateConfig(): Promise<boolean> {
    return this.provider.validateConfig?.() ?? true;
  }

  async cleanup(): Promise<void> {
    this.memoryCache.clear();
    await this.provider.cleanup?.();
  }

  getCacheStats() {
    return {
      memorySize: this.memoryCache.size(),
      diskCacheEnabled: this.diskCacheEnabled,
      cacheDir: this.cacheDir,
    };
  }
}

/**
 * Rollout provider wrapper for gradual feature rollout
 */
class RolloutProvider implements AnalyzeProvider {
  private primaryProvider: AnalyzeProvider;
  private fallbackProvider: AnalyzeProvider;
  private rolloutPercent: number;
  private log = createOperationLogger('RolloutProvider');

  constructor(
    primaryProvider: AnalyzeProvider,
    fallbackProvider: AnalyzeProvider,
    rolloutPercent: number
  ) {
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;
    this.rolloutPercent = Math.max(0, Math.min(100, rolloutPercent));
  }

  get name() { return this.primaryProvider.name; }
  get config() { return this.primaryProvider.config; }

  /**
   * Determine which provider to use based on rollout percentage
   */
  private selectProvider(path: string): AnalyzeProvider {
    if (this.rolloutPercent === 0) return this.fallbackProvider;
    if (this.rolloutPercent === 100) return this.primaryProvider;
    
    // Deterministic selection based on path hash
    const hash = createHash('sha256').update(path).digest('hex');
    const bucket = parseInt(hash.substring(0, 8), 16) % 100;
    const selected = bucket < this.rolloutPercent ? this.primaryProvider : this.fallbackProvider;
    
    this.log.debug({ 
      path, 
      bucket, 
      rolloutPercent: this.rolloutPercent,
      selected: selected.name 
    }, 'Rollout provider selection');
    
    return selected;
  }

  async analyze(path: string, buffer: Buffer): Promise<ImageDescriptor> {
    const provider = this.selectProvider(path);
    return provider.analyze(path, buffer);
  }

  async analyzeBatch(items: Array<{path: string, buffer: Buffer}>): Promise<ImageDescriptor[]> {
    // Group by provider for efficient batch processing
    const primaryItems: typeof items = [];
    const fallbackItems: typeof items = [];
    
    for (const item of items) {
      const provider = this.selectProvider(item.path);
      if (provider === this.primaryProvider) {
        primaryItems.push(item);
      } else {
        fallbackItems.push(item);
      }
    }
    
    // Process batches in parallel
    const [primaryResults, fallbackResults] = await Promise.all([
      primaryItems.length > 0 ? this.primaryProvider.analyzeBatch(primaryItems) : [],
      fallbackItems.length > 0 ? this.fallbackProvider.analyzeBatch(fallbackItems) : [],
    ]);
    
    // Merge results in original order
    const results: ImageDescriptor[] = [];
    let primaryIndex = 0;
    let fallbackIndex = 0;
    
    for (const item of items) {
      const provider = this.selectProvider(item.path);
      if (provider === this.primaryProvider) {
        results.push(primaryResults[primaryIndex++]!);
      } else {
        results.push(fallbackResults[fallbackIndex++]!);
      }
    }
    
    return results;
  }

  async estimateCost(imageCount: number): Promise<CostEstimate> {
    // Estimate based on rollout split
    const primaryCount = Math.floor(imageCount * this.rolloutPercent / 100);
    const fallbackCount = imageCount - primaryCount;
    
    const [primaryCost, fallbackCost] = await Promise.all([
      primaryCount > 0 ? this.primaryProvider.estimateCost(primaryCount) : Promise.resolve({
        imageCount: 0, estimatedCost: 0, estimatedTimeMs: 0, provider: this.primaryProvider.name
      }),
      fallbackCount > 0 ? this.fallbackProvider.estimateCost(fallbackCount) : Promise.resolve({
        imageCount: 0, estimatedCost: 0, estimatedTimeMs: 0, provider: this.fallbackProvider.name
      }),
    ]);
    
    return {
      imageCount,
      estimatedCost: primaryCost.estimatedCost + fallbackCost.estimatedCost,
      estimatedTimeMs: Math.max(primaryCost.estimatedTimeMs, fallbackCost.estimatedTimeMs),
      provider: this.primaryProvider.name, // Report primary for rollout tracking
    };
  }

  async validateConfig(): Promise<boolean> {
    const [primaryValid, fallbackValid] = await Promise.all([
      this.primaryProvider.validateConfig?.() ?? true,
      this.fallbackProvider.validateConfig?.() ?? true,
    ]);
    return primaryValid && fallbackValid;
  }

  async cleanup(): Promise<void> {
    await Promise.all([
      this.primaryProvider.cleanup?.(),
      this.fallbackProvider.cleanup?.(),
    ]);
  }
}

/**
 * Create analyze provider with factory configuration
 * Includes kill-switch, caching, and rollout support
 */
export function createAnalyzeProvider(config: ProviderFactoryConfig): AnalyzeProvider {
  const log = createOperationLogger('ProviderFactory', { config });
  
  // KILL SWITCH: Always return Sharp if kill-switch is enabled
  if (config.killSwitch) {
    log.info('Kill-switch enabled - forcing Sharp provider');
    return new SharpProvider();
  }
  
  // Base providers
  let primaryProvider: AnalyzeProvider;
  let fallbackProvider: AnalyzeProvider = new SharpProvider(); // Always Sharp fallback
  
  switch (config.provider) {
    case 'gemini':
      // Note: GeminiProvider will be implemented in PR-2
      log.info('Gemini provider requested but not yet implemented - using Sharp');
      primaryProvider = new SharpProvider();
      break;
    case 'sharp':
    default:
      primaryProvider = new SharpProvider();
      break;
  }
  
  // Apply caching wrapper if enabled
  if (config.cacheEnabled) {
    log.debug('Applying caching wrapper');
    primaryProvider = new CachedProvider(primaryProvider, {
      maxCacheSize: config.maxCacheSize,
      diskCacheEnabled: config.diskCacheEnabled,
    });
    
    // Also cache fallback if different
    if (primaryProvider.name !== fallbackProvider.name) {
      fallbackProvider = new CachedProvider(fallbackProvider, {
        maxCacheSize: config.maxCacheSize,
        diskCacheEnabled: config.diskCacheEnabled,
      });
    }
  }
  
  // Apply rollout wrapper if needed
  if (config.rolloutPercent > 0 && config.rolloutPercent < 100 && 
      primaryProvider.name !== fallbackProvider.name) {
    log.info({ rolloutPercent: config.rolloutPercent }, 'Applying rollout wrapper');
    return new RolloutProvider(primaryProvider, fallbackProvider, config.rolloutPercent);
  }
  
  return primaryProvider;
}

/**
 * Default factory configuration
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderFactoryConfig = {
  provider: 'sharp',
  rolloutPercent: 0,
  killSwitch: false,
  cacheEnabled: true,
  maxCacheSize: 256,
  diskCacheEnabled: false,
};