import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { 
  PreflightBudgets, 
  PreflightResult, 
  RefRegistry, 
  RefRegistryEntry,
  ReferencePack 
} from '../types/refs.js';
import { PromptRow, Problem } from '../types.js';
import { createOperationLogger } from '../logger.js';
import { env } from '../config/env.js';

const log = createOperationLogger('preflight');

/**
 * Calculate SHA256 hash of file content
 */
async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compress image if needed (resize to max 1024px, quality 75)
 */
async function compressImage(path: string): Promise<Buffer> {
  const image = sharp(path);
  const metadata = await image.metadata();
  
  const maxDimension = 1024;
  let resizeOptions: any = undefined;
  
  if (metadata.width && metadata.height) {
    if (metadata.width > maxDimension || metadata.height > maxDimension) {
      resizeOptions = {
        width: metadata.width > metadata.height ? maxDimension : undefined,
        height: metadata.height > metadata.width ? maxDimension : undefined,
        fit: 'inside',
        withoutEnlargement: true
      };
    }
  }
  
  let pipeline = image;
  if (resizeOptions) {
    pipeline = pipeline.resize(resizeOptions);
  }
  
  // Convert to JPEG with quality 75
  return pipeline
    .jpeg({ quality: 75, progressive: true })
    .toBuffer();
}

/**
 * Build reference registry with deduplication
 */
async function buildRegistry(
  pack: ReferencePack,
  compress: boolean
): Promise<RefRegistry> {
  const registry: RefRegistry = {
    entries: {},
    totalSize: 0,
    compressedSize: 0,
    uniqueCount: 0
  };
  
  const processRef = async (path: string): Promise<void> => {
    // Skip if already processed
    const hash = await hashFile(path);
    if (registry.entries[hash]) {
      return;
    }
    
    // Read original file
    const original = await readFile(path);
    const originalSize = original.length;
    
    let compressed: Buffer | undefined;
    let compressedSize = originalSize;
    
    if (compress && path.match(/\.(jpg|jpeg|png|webp)$/i)) {
      try {
        compressed = await compressImage(path);
        compressedSize = compressed.length;
        
        log.debug({
          path,
          originalSize,
          compressedSize,
          ratio: (compressedSize / originalSize).toFixed(2)
        }, 'Image compressed');
      } catch (error) {
        log.warn({ path, error }, 'Compression failed, using original');
      }
    }
    
    // Add to registry
    const entry: RefRegistryEntry = {
      id: `ref_${hash.slice(0, 12)}`,
      hash,
      path,
      size: originalSize,
      compressed: compress && compressed !== undefined,
      compressedSize: compress ? compressedSize : undefined,
      mimeType: path.endsWith('.png') ? 'image/png' : 'image/jpeg'
    };
    
    registry.entries[hash] = entry;
    registry.totalSize += originalSize;
    registry.compressedSize += compressedSize;
    registry.uniqueCount++;
  };
  
  // Process all references
  const allPaths: string[] = [];
  
  if (pack.style) {
    allPaths.push(...pack.style.map(s => s.path));
  }
  if (pack.props) {
    allPaths.push(...pack.props.map(p => p.path));
  }
  if (pack.subject) {
    allPaths.push(...pack.subject.map(s => s.face));
  }
  if (pack.pose) {
    allPaths.push(...pack.pose.map(p => p.path));
  }
  if (pack.environment) {
    allPaths.push(...pack.environment.map(e => e.path));
  }
  
  // Process in parallel with concurrency limit
  const concurrency = 5;
  for (let i = 0; i < allPaths.length; i += concurrency) {
    const batch = allPaths.slice(i, i + concurrency);
    await Promise.all(batch.map(processRef));
  }
  
  return registry;
}

/**
 * Estimate payload size for a single item
 */
function estimateItemSize(
  row: PromptRow,
  refCount: number,
  avgRefSize: number
): number {
  // Estimate: prompt text + metadata + references
  const promptSize = new TextEncoder().encode(row.prompt).length;
  const metadataSize = 1024; // Rough estimate for JSON wrapper
  const refsSize = refCount * avgRefSize;
  
  return promptSize + metadataSize + refsSize;
}

/**
 * Check budgets and potentially split into chunks
 */
function checkBudgets(
  rows: PromptRow[],
  registry: RefRegistry,
  budgets: PreflightBudgets
): { chunks: number; problems?: Problem[] } {
  const problems: Problem[] = [];
  
  // Check total image count
  const totalImages = rows.length * 3; // Assume max variants
  if (totalImages > budgets.maxImagesPerJob) {
    if (!budgets.split) {
      problems.push({
        type: 'preflight/budget-exceeded',
        title: 'Image count exceeds job limit',
        detail: `Total images (${totalImages}) exceeds limit (${budgets.maxImagesPerJob})`,
        status: 413,
        instance: crypto.randomUUID()
      });
      return { chunks: 0, problems };
    }
  }
  
  // Check per-item size
  const avgRefSize = registry.compressedSize / Math.max(registry.uniqueCount, 1);
  const maxItemSize = Math.max(
    ...rows.map(row => estimateItemSize(row, Object.keys(registry.entries).length, avgRefSize))
  );
  
  if (maxItemSize > budgets.itemMaxBytes) {
    problems.push({
      type: 'preflight/item-too-large',
      title: 'Item payload exceeds limit',
      detail: `Largest item (${maxItemSize} bytes) exceeds limit (${budgets.itemMaxBytes} bytes)`,
      status: 413,
      instance: crypto.randomUUID()
    });
    return { chunks: 0, problems };
  }
  
  // Check total job size
  const totalJobSize = rows.length * avgRefSize + registry.compressedSize;
  if (totalJobSize > budgets.jobMaxBytes) {
    if (!budgets.split) {
      problems.push({
        type: 'preflight/job-too-large',
        title: 'Job payload exceeds limit',
        detail: `Total job size (${totalJobSize} bytes) exceeds limit (${budgets.jobMaxBytes} bytes)`,
        status: 413,
        instance: crypto.randomUUID()
      });
      return { chunks: 0, problems };
    }
    
    // Calculate chunks needed
    const chunks = Math.ceil(totalJobSize / budgets.jobMaxBytes);
    log.info({ 
      totalJobSize, 
      jobMaxBytes: budgets.jobMaxBytes, 
      chunks 
    }, 'Job will be split into chunks');
    
    return { chunks };
  }
  
  return { chunks: 1 };
}

/**
 * Run preflight checks on batch submission
 */
export async function preflight(
  rows: PromptRow[],
  pack: ReferencePack | undefined,
  budgets: PreflightBudgets
): Promise<PreflightResult> {
  log.info({ 
    rowCount: rows.length,
    hasPack: !!pack,
    budgets 
  }, 'Starting preflight checks');
  
  // No refs case
  if (!pack) {
    return {
      ok: true,
      chunks: 1,
      uniqueRefs: 0,
      bytes: { before: 0, after: 0 }
    };
  }
  
  try {
    // Build registry with deduplication
    const registry = await buildRegistry(pack, budgets.compress);
    
    log.info({
      uniqueRefs: registry.uniqueCount,
      totalSize: registry.totalSize,
      compressedSize: registry.compressedSize,
      compressionRatio: (registry.compressedSize / registry.totalSize).toFixed(2)
    }, 'Reference registry built');
    
    // Check budgets
    const { chunks, problems } = checkBudgets(rows, registry, budgets);
    
    if (problems && problems.length > 0) {
      return {
        ok: false,
        chunks: 0,
        uniqueRefs: registry.uniqueCount,
        bytes: {
          before: registry.totalSize,
          after: registry.compressedSize
        },
        problems
      };
    }
    
    // Success
    return {
      ok: true,
      chunks,
      uniqueRefs: registry.uniqueCount,
      bytes: {
        before: registry.totalSize,
        after: registry.compressedSize
      },
      registry
    };
    
  } catch (error) {
    log.error({ error }, 'Preflight check failed');
    
    return {
      ok: false,
      chunks: 0,
      uniqueRefs: 0,
      bytes: { before: 0, after: 0 },
      problems: [{
        type: 'preflight/error',
        title: 'Preflight check failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
        instance: crypto.randomUUID()
      }]
    };
  }
}

/**
 * Load budget configuration from environment
 */
export function loadBudgetsFromEnv(): PreflightBudgets {
  return {
    jobMaxBytes: env.JOB_MAX_BYTES,
    itemMaxBytes: env.ITEM_MAX_BYTES,
    maxRefsPerItem: env.MAX_REFS_PER_ITEM,
    maxImagesPerJob: env.MAX_IMAGES_PER_JOB,
    compress: env.PREFLIGHT_COMPRESS,
    split: env.PREFLIGHT_SPLIT
  };
}