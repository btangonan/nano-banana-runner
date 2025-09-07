import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createOperationLogger, logTiming } from '../logger.js';
import { GeminiImageAdapter } from '../adapters/geminiImage.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import { hasRecentProbe } from './runProbe.js';
import type { RenderRequest, PromptRow } from '../types.js';
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
 * Render images from prompts using Gemini 2.5 Flash (dry-run or live)
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
    dryRun: opts.dryRun
  }, `Starting render workflow (${opts.dryRun ? 'dry-run' : 'live'})`);

  try {
    // Check for recent probe if running live
    if (!opts.dryRun) {
      const hasProbe = await hasRecentProbe();
      if (!hasProbe) {
        throw new Error(
          'No recent probe found. Run "nn probe" first to verify Vertex AI connectivity. ' +
          'This safety check prevents accidental API calls and spending.'
        );
      }
      log.info('Recent probe found, proceeding with live generation');
    }
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
    
    // Create render request
    const request: RenderRequest = {
      rows: prompts,
      variants: opts.variants as 1 | 2 | 3,
      styleOnly: true,
      styleRefs,
      runMode: opts.dryRun ? 'dry_run' : 'live'
    };
    
    // Initialize Gemini adapter (works for both dry-run and live)
    const adapter = new GeminiImageAdapter({
      project: env.GOOGLE_CLOUD_PROJECT!,
      location: env.GOOGLE_CLOUD_LOCATION
    });
    
    // Execute render (dry-run cost estimation or actual generation)
    const result = await adapter.render(request);
    
    if (opts.dryRun) {
      // Display cost estimation
      if (result.costPlan) {
        log.info({ 
          costPlan: result.costPlan 
        }, 'Cost estimation completed');
        
        // Pretty print cost information
        console.log('\n📊 Cost Estimation:');
        console.log(`   Images: ${result.costPlan.imageCount}`);
        if (result.costPlan.estimatedCost) {
          console.log(`   Estimated cost: $${result.costPlan.estimatedCost.toFixed(4)}`);
        }
        console.log(`   Estimated time: ${result.costPlan.estimatedTime}`);
        console.log(`   Concurrency: ${result.costPlan.concurrency}`);
        if (result.costPlan.warning) {
          console.log(`   ⚠️  ${result.costPlan.warning}`);
        }
        if (result.costPlan.priceNote) {
          console.log(`   💡 ${result.costPlan.priceNote}`);
        }
      }
    } else {
      // Log live generation results
      log.info({ 
        generated: result.results.length,
        outputDir: opts.outDir 
      }, 'Live generation completed');
      
      console.log(`\n✅ Generated ${result.results.length} images in ${opts.outDir}`);
    }
    
    // Record success in manifest
    await manifest.recordSuccess(
      'render',
      opts.promptsPath,
      opts.dryRun ? 'dry-run-estimation' : opts.outDir,
      {
        prompts: prompts.length,
        styleRefs: styleRefs.length,
        variants: opts.variants,
        runMode: opts.dryRun ? 'dry_run' : 'live',
        results: result.results.length,
        costPlan: result.costPlan
      }
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
      instance: crypto.randomUUID()
    });
    
    throw error;
  }
}