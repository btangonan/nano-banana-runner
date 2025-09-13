import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOperationLogger, logTiming } from '../logger.js';
import { isSupportedImage } from '../core/analyze.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';

interface AnalyzeCinematicOptions {
  inDir: string;
  outPath: string;
  concurrency: number;
  ultra?: boolean;  // Enable ultra-cinematic mode
  apiUrl?: string;  // Override API URL for testing
}

/**
 * Analyze images using the cinematic API endpoint for rich, production-grade descriptions
 */
export async function runAnalyzeCinematic(opts: AnalyzeCinematicOptions): Promise<void> {
  const log = createOperationLogger('runAnalyzeCinematic');
  const startTime = Date.now();
  
  // Default to ultra mode for maximum quality
  const ultra = opts.ultra !== false;
  const apiUrl = opts.apiUrl || 'http://127.0.0.1:8787';
  
  log.info({ 
    inDir: opts.inDir, 
    outPath: opts.outPath, 
    concurrency: opts.concurrency,
    ultra,
    apiUrl
  }, 'Starting cinematic analysis workflow');

  try {
    // Read input directory
    const files = await readdir(opts.inDir);
    const imagePaths = files
      .filter(isSupportedImage)
      .map(file => join(opts.inDir, file));
    
    if (imagePaths.length === 0) {
      throw new Error(`No supported images found in directory: ${opts.inDir}`);
    }
    
    log.info({ count: imagePaths.length }, 'Found supported images for cinematic analysis');
    
    // Process images with concurrency control
    const descriptors = await analyzeCinematicBatch(
      imagePaths, 
      opts.concurrency, 
      ultra, 
      apiUrl,
      log
    );
    
    // Count successful vs failed analyses
    const successful = descriptors.filter(d => !d.error);
    const failed = descriptors.filter(d => d.error);
    
    if (failed.length > 0) {
      log.warn({ 
        failedCount: failed.length,
        errors: failed.map(d => ({ path: d.path, error: d.error }))
      }, 'Some images failed cinematic analysis');
    }
    
    // Write results using atomic file operations
    const manifest = new FileSystemManifest();
    await manifest.writeJSON(opts.outPath, successful);
    
    // Record success in manifest
    await manifest.recordSuccess(
      'analyze-cinematic',
      opts.inDir,
      opts.outPath,
      {
        totalImages: imagePaths.length,
        successful: successful.length,
        failed: failed.length,
        concurrency: opts.concurrency,
        ultra
      }
    );
    
    logTiming(log, 'runAnalyzeCinematic', startTime);
    log.info({ 
      output: opts.outPath,
      total: descriptors.length,
      successful: successful.length,
      failed: failed.length,
      ultra
    }, 'Cinematic analysis workflow completed');
    
  } catch (error) {
    log.error({ error }, 'Cinematic analysis workflow failed');
    
    // Record failure in manifest
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('analyze-cinematic', opts.inDir, {
      type: 'about:blank',
      title: 'Cinematic analysis workflow failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: randomUUID()
    });
    
    throw error;
  }
}

/**
 * Analyze images in batches with concurrency control
 */
async function analyzeCinematicBatch(
  imagePaths: string[],
  concurrency: number,
  ultra: boolean,
  apiUrl: string,
  log: ReturnType<typeof createOperationLogger>
): Promise<any[]> {
  const results: any[] = [];
  
  // Process in batches
  for (let i = 0; i < imagePaths.length; i += concurrency) {
    const batch = imagePaths.slice(i, i + concurrency);
    
    log.info({ 
      batchStart: i, 
      batchSize: batch.length,
      total: imagePaths.length 
    }, 'Processing batch');
    
    // Analyze batch in parallel
    const batchResults = await Promise.all(
      batch.map(imagePath => analyzeSingleImage(imagePath, ultra, apiUrl, log))
    );
    
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Analyze a single image using the cinematic API
 */
async function analyzeSingleImage(
  imagePath: string,
  ultra: boolean,
  apiUrl: string,
  log: ReturnType<typeof createOperationLogger>
): Promise<any> {
  try {
    // Read and encode image
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Build API URL with ultra parameter
    const endpoint = ultra 
      ? `${apiUrl}/analyze/cinematic?ultra=true`
      : `${apiUrl}/analyze/cinematic`;
    
    log.info({ imagePath, ultra }, 'Calling cinematic API');
    
    // Call cinematic API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    // Add the original path to the descriptor
    if (result.descriptor) {
      result.descriptor.path = imagePath;
    }
    
    return result.descriptor || result;
    
  } catch (error) {
    log.error({ imagePath, error }, 'Failed to analyze image');
    
    // Return error descriptor
    return {
      path: imagePath,
      error: error instanceof Error ? error.message : 'Unknown error',
      provider: 'gemini',
      width: 0,
      height: 0,
      format: 'unknown'
    };
  }
}