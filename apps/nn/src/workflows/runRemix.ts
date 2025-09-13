import { createOperationLogger, logTiming } from '../logger.js';
import { generatePrompts } from '../core/remix/index.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import type { ImageDescriptor } from '../types.js';

interface RemixOptions {
  descriptorsPath: string;
  outPath: string;
  maxPerImage: number;
  seed: number;
}

/**
 * Generate prompt variations from image descriptors
 */
export async function runRemix(opts: RemixOptions): Promise<void> {
  const log = createOperationLogger('runRemix');
  const startTime = Date.now();
  
  log.info({ 
    descriptorsPath: opts.descriptorsPath,
    outPath: opts.outPath,
    maxPerImage: opts.maxPerImage,
    seed: opts.seed
  }, 'Starting prompt remix workflow');

  try {
    // Read descriptors from input file
    const manifest = new FileSystemManifest();
    const descriptors = await manifest.readJSON<ImageDescriptor[]>(opts.descriptorsPath);
    
    if (descriptors.length === 0) {
      throw new Error(`No image descriptors found in file: ${opts.descriptorsPath}`);
    }
    
    log.info({ count: descriptors.length }, 'Loaded image descriptors');
    
    // Generate prompts with deterministic seeding
    const prompts = await generatePrompts(descriptors, {
      maxPerImage: opts.maxPerImage,
      seed: opts.seed,
      maxStyleAdj: 3,  // Default from remix module
      maxLighting: 2   // Default from remix module
    });
    
    if (prompts.length === 0) {
      throw new Error('No prompts were generated from the provided descriptors');
    }
    
    // Write prompts as JSONL (one JSON object per line)
    const jsonlContent = prompts
      .map(prompt => JSON.stringify(prompt))
      .join('\n') + '\n';
    
    await manifest.writeAtomic(opts.outPath, jsonlContent);
    
    // Record success in manifest
    await manifest.recordSuccess(
      'remix',
      opts.descriptorsPath,
      opts.outPath,
      {
        inputDescriptors: descriptors.length,
        outputPrompts: prompts.length,
        maxPerImage: opts.maxPerImage,
        seed: opts.seed,
        avgPromptsPerImage: Math.round(prompts.length / descriptors.length * 100) / 100
      }
    );
    
    logTiming(log, 'runRemix', startTime);
    log.info({ 
      output: opts.outPath,
      generated: prompts.length,
      avgPerImage: Math.round(prompts.length / descriptors.length * 100) / 100
    }, 'Remix workflow completed');
    
  } catch (error) {
    log.error({ error }, 'Remix workflow failed');
    
    // Record failure in manifest
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('remix', opts.descriptorsPath, {
      type: 'about:blank',
      title: 'Remix workflow failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: crypto.randomUUID()
    });
    
    throw error;
  }
}