import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOperationLogger, logTiming } from '../logger.js';
import { 
  generateImages, 
  isBatchJob, 
  isDirectResult
} from '../adapters/providerFactory.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import type { PromptRow } from '../types.js';
import { env } from '../config/env.js';

interface RenderOptions {
  promptsPath: string;
  styleDir: string;
  outDir: string;
  variants: number;
  concurrency: number;
  dryRun: boolean;
}

/**
 * Get supported image files from style directory
 */
function getSupportedImageFiles(files: string[]): string[] {
  const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  return files.filter(f => supportedExtensions.has(extname(f).toLowerCase()));
}

/**
 * Render images from prompts using configured provider (batch-first, vertex fallback)
 */
export async function runRender(opts: RenderOptions): Promise<void> {
  const log = createOperationLogger('runRender');
  const startTime = Date.now();
  
  log.info({ 
    promptsPath: opts.promptsPath,
    styleDir: opts.styleDir,
    outDir: opts.outDir,
    variants: opts.variants,
    concurrency: opts.concurrency,
    dryRun: opts.dryRun,
    provider: env.NN_PROVIDER
  }, `Starting render workflow (${opts.dryRun ? 'dry-run' : 'live'})`);

  try {
    // Read prompts from JSONL file
    const manifest = new FileSystemManifest();
    const promptsContent = await manifest.readFile(opts.promptsPath);
    const prompts: PromptRow[] = promptsContent
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    if (prompts.length === 0) {
      throw new Error(`No prompts found in file: ${opts.promptsPath}`);
    }
    
    log.info({ count: prompts.length }, 'Loaded prompts from JSONL');
    
    // Read style reference images
    const styleFiles = await readdir(opts.styleDir);
    const supportedImages = getSupportedImageFiles(styleFiles);
    const styleRefs = supportedImages.map(f => join(opts.styleDir, f));
    
    if (styleRefs.length === 0) {
      throw new Error(`No supported style images found in directory: ${opts.styleDir}`);
    }
    
    log.info({ count: styleRefs.length }, 'Found style reference images');
    
    // Generate using configured provider (batch-first, vertex fallback)
    const result = await generateImages({
      rows: prompts,
      variants: opts.variants as 1 | 2 | 3,
      styleOnly: true, // Always enforce style-only conditioning
      styleRefs: styleFiles.map(f => join(opts.styleDir, f)),
      runMode: opts.dryRun ? 'dry_run' : 'live'
    });
    
    if (isBatchJob(result)) {
      // Batch provider: job submitted, return job info
      log.info({ 
        jobId: result.jobId, 
        estCount: result.estCount 
      }, 'Batch job submitted');
      
      if (opts.dryRun) {
        console.log('\n📊 Batch Estimation:');
        console.log(`   Prompts: ${prompts.length}`);
        console.log(`   Variants: ${opts.variants}`);
        console.log(`   Total images: ${result.estCount}`);
        console.log(`   Estimated time: ${Math.ceil(result.estCount / 10)}s`);
        console.log('\n   Run with --live --yes to submit actual job');
      } else {
        console.log(`\n✅ Batch job submitted: ${result.jobId}`);
        console.log(`   Estimated images: ${result.estCount}`);
        console.log(`   Use: nn batch poll --job ${result.jobId} --watch`);
        console.log(`   Then: nn batch fetch --job ${result.jobId}`);
      }
      
    } else if (isDirectResult(result)) {
      // Sync provider: images generated directly
      const renderResult = result.result;
      
      if (opts.dryRun) {
        // Display cost estimation for sync provider
        if (renderResult.costPlan) {
          log.info({ 
            costPlan: renderResult.costPlan 
        }, 'Cost estimation completed');
        
        // Pretty print cost information
        console.log('\n📊 Cost Estimation:');
        console.log(`   Images: ${renderResult.costPlan.imageCount}`);
        if (renderResult.costPlan.estimatedCost) {
          console.log(`   Estimated cost: $${renderResult.costPlan.estimatedCost.toFixed(4)}`);
        }
        console.log(`   Estimated time: ${renderResult.costPlan.estimatedTime}`);
        console.log(`   Concurrency: ${renderResult.costPlan.concurrency}`);
        if (renderResult.costPlan.warning) {
          console.log(`   ⚠️  ${renderResult.costPlan.warning}`);
        }
        if (renderResult.costPlan.priceNote) {
          console.log(`   💡 ${renderResult.costPlan.priceNote}`);
        }
      }
      } else {
        // Log live generation results for sync provider
        log.info({ 
          generated: renderResult.results.length,
          outputDir: opts.outDir 
        }, 'Live generation completed');
        
        console.log(`\n✅ Generated ${renderResult.results.length} images in ${opts.outDir}`);
      }
    }
    
    // Record success in manifest with appropriate metadata
    const metadata = {
      prompts: prompts.length,
      styleRefs: styleRefs.length,
      variants: opts.variants,
      runMode: opts.dryRun ? 'dry_run' : 'live',
      provider: env.NN_PROVIDER,
      ...(isBatchJob(result) 
        ? { jobId: result.jobId, estCount: result.estCount }
        : { 
            results: result.result.results.length, 
            costPlan: result.result.costPlan 
          }
      )
    };
    
    await manifest.recordSuccess(
      'render',
      opts.promptsPath,
      opts.dryRun ? 'dry-run-estimation' : opts.outDir,
      metadata
    );
    
    logTiming(log, 'runRender', startTime);
    log.info('Render workflow completed successfully');
    
  } catch (error) {
    log.error({ error }, 'Render workflow failed');
    
    // Record failure in manifest
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('render', opts.promptsPath, {
      type: 'about:blank',
      title: 'Render workflow failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: randomUUID()
    });
    
    throw error;
  }
}