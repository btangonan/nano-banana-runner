import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOperationLogger, logTiming } from '../logger.js';
import { analyzeImages, isSupportedImage } from '../core/analyze.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import type { ImageDescriptor } from '../types.js';

interface AnalyzeOptions {
  inDir: string;
  outPath: string;
  concurrency: number;
}

/**
 * Analyze images in a directory and output descriptors
 */
export async function runAnalyze(opts: AnalyzeOptions): Promise<void> {
  const log = createOperationLogger('runAnalyze');
  const startTime = Date.now();
  
  log.info({ 
    inDir: opts.inDir, 
    outPath: opts.outPath, 
    concurrency: opts.concurrency 
  }, 'Starting image analysis workflow');

  try {
    // Read input directory
    const files = await readdir(opts.inDir);
    const imagePaths = files
      .filter(isSupportedImage)
      .map(file => join(opts.inDir, file));
    
    if (imagePaths.length === 0) {
      throw new Error(`No supported images found in directory: ${opts.inDir}`);
    }
    
    log.info({ count: imagePaths.length }, 'Found supported images');
    
    // Analyze all images with concurrency control
    const descriptors = await analyzeImages(imagePaths, opts.concurrency);
    
    // Count successful vs failed analyses
    const successful = descriptors.filter(d => !d.errors?.length);
    const failed = descriptors.filter(d => d.errors?.length);
    
    if (failed.length > 0) {
      log.warn({ 
        failedCount: failed.length,
        errors: failed.map(d => ({ path: d.path, errors: d.errors }))
      }, 'Some images failed to analyze');
    }
    
    // Write results using atomic file operations
    const manifest = new FileSystemManifest();
    await manifest.writeJSON<ImageDescriptor[]>(opts.outPath, descriptors);
    
    // Record success in manifest
    await manifest.recordSuccess(
      'analyze',
      opts.inDir,
      opts.outPath,
      {
        totalImages: imagePaths.length,
        successful: successful.length,
        failed: failed.length,
        concurrency: opts.concurrency
      }
    );
    
    logTiming(log, 'runAnalyze', startTime);
    log.info({ 
      output: opts.outPath,
      total: descriptors.length,
      successful: successful.length,
      failed: failed.length
    }, 'Analysis workflow completed');
    
  } catch (error) {
    log.error({ error }, 'Analysis workflow failed');
    
    // Record failure in manifest
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('analyze', opts.inDir, {
      type: 'about:blank',
      title: 'Analysis workflow failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: randomUUID()
    });
    
    throw error;
  }
}