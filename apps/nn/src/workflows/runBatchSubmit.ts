import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createOperationLogger, logTiming } from '../logger.js';
import { createProvider } from '../adapters/providerFactory.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import { PromptRow, JobManifest, ProviderName } from '../types.js';
import { env } from '../config/env.js';
import { loadReferencePack, getPackDigest, getTotalRefCount, getActiveModes } from '../config/refs.js';
import { RefMode, ReferencePack } from '../types/refs.js';
import { preflight, loadBudgetsFromEnv } from './preflight.js';

interface BatchSubmitOptions {
  provider?: ProviderName;        // per-job override (optional)
  promptsPath: string;
  styleDir?: string;
  refsPath?: string;
  refMode?: RefMode;
  variants: 1 | 2 | 3;
  compress?: boolean;
  split?: boolean;
  dryRun: boolean;
}

/**
 * Submit batch job for image generation
 */
export async function runBatchSubmit(opts: BatchSubmitOptions): Promise<void> {
  const log = createOperationLogger('runBatchSubmit');
  const startTime = Date.now();
  
  log.info({ 
    provider: opts.provider,
    promptsPath: opts.promptsPath,
    styleDir: opts.styleDir,
    refsPath: opts.refsPath,
    refMode: opts.refMode,
    variants: opts.variants,
    dryRun: opts.dryRun
  }, `Starting batch submit (${opts.dryRun ? 'dry-run' : 'live'})`);
  
  try {
    // Read prompts from JSONL file
    const manifest = new FileSystemManifest();
    const promptsContent = await manifest.readFile(opts.promptsPath);
    const rows: PromptRow[] = promptsContent
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    if (rows.length === 0) {
      throw new Error(`No prompts found in file: ${opts.promptsPath}`);
    }
    
    log.info({ count: rows.length }, 'Loaded prompts from JSONL');
    
    // Load references (new pack format or legacy style-dir)
    let pack: ReferencePack | undefined;
    let styleRefs: string[] = [];
    let packDigest: string | undefined;
    
    if (opts.refsPath) {
      // Load reference pack
      pack = await loadReferencePack(opts.refsPath);
      packDigest = getPackDigest(pack);
      
      // Extract style refs for compatibility
      if (pack.style) {
        styleRefs = pack.style.map(s => s.path);
      }
      
      log.info({ 
        packDigest,
        totalRefs: getTotalRefCount(pack),
        activeModes: getActiveModes(pack)
      }, 'Loaded reference pack');
      
    } else if (opts.styleDir) {
      // Legacy: Read style reference images from directory
      const styleFiles = await readdir(opts.styleDir);
      const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
      styleRefs = styleFiles
        .filter(f => supportedExtensions.has(extname(f).toLowerCase()))
        .map(f => join(opts.styleDir, f));
      
      if (styleRefs.length === 0) {
        throw new Error(`No supported style images found in directory: ${opts.styleDir}`);
      }
      
      // Create a minimal pack for compatibility
      pack = {
        version: '1.0',
        style: styleRefs.map(path => ({ path, weight: 1 }))
      };
      
      log.info({ count: styleRefs.length }, 'Found style reference images (legacy)');
    }
    
    // Run preflight checks
    const budgets = {
      ...loadBudgetsFromEnv(),
      compress: opts.compress ?? true,
      split: opts.split ?? true
    };
    
    const preflightResult = await preflight(rows, pack, budgets);
    
    if (!preflightResult.ok) {
      log.error({ problems: preflightResult.problems }, 'Preflight checks failed');
      
      // Display problems
      console.error('\n❌ Preflight checks failed:');
      preflightResult.problems?.forEach(p => {
        console.error(`   ${p.title}: ${p.detail}`);
      });
      
      throw new Error('Preflight checks failed');
    }
    
    log.info({
      chunks: preflightResult.chunks,
      uniqueRefs: preflightResult.uniqueRefs,
      bytes: preflightResult.bytes
    }, 'Preflight checks passed');
    
    // Dry run: estimate only
    if (opts.dryRun) {
      const estCount = rows.length * opts.variants;
      const estTime = Math.ceil(estCount / 4) * 3; // Rough estimate: 3s per image, 4 concurrent
      
      console.log('\n📊 Batch Estimation:');
      console.log(`   Prompts: ${rows.length}`);
      console.log(`   Variants: ${opts.variants}`);
      console.log(`   Total images: ${estCount}`);
      console.log(`   Estimated time: ${estTime}s`);
      
      // Reference info
      if (pack) {
        console.log('\n📦 References:');
        console.log(`   Mode: ${opts.refMode || 'style'}`);
        console.log(`   Pack digest: ${packDigest}`);
        console.log(`   Total refs: ${getTotalRefCount(pack)}`);
        console.log(`   Active modes: ${getActiveModes(pack).join(', ')}`);
      } else {
        console.log(`   Style refs: ${styleRefs.length}`);
      }
      
      // Preflight info
      console.log('\n✈️  Preflight:');
      console.log(`   Unique refs: ${preflightResult.uniqueRefs}`);
      console.log(`   Size before: ${(preflightResult.bytes.before / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Size after: ${(preflightResult.bytes.after / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Compression: ${((1 - preflightResult.bytes.after / preflightResult.bytes.before) * 100).toFixed(1)}%`);
      console.log(`   Chunks: ${preflightResult.chunks}`);
      
      // Cost warning for high ref density
      if (preflightResult.uniqueRefs > 6 || preflightResult.bytes.after > 6 * 1024 * 1024) {
        console.log('\n⚠️  High reference density detected');
        console.log('   Costs and latency may increase. Consider dedup + downscale.');
      }
      
      console.log('\n   Run with --live --yes to submit actual job');
      
      return;
    }
    
    // Create provider with override support
    const provider = await createProvider(opts.provider);
    
    // Submit job using provider factory
    const result = await provider.generate({
      rows,
      variants: opts.variants,
      styleOnly: true,
      styleRefs,
      runMode: opts.dryRun ? 'dry_run' : 'live'
    });
    
    // Handle different result types from provider
    let jobId: string;
    let estCount: number;
    const chosenProvider = opts.provider ?? (env.NN_PROVIDER === 'vertex' ? 'vertex' : 'batch');
    const providerName = chosenProvider === 'vertex' ? 'vertex' : 'gemini-batch';
    
    if (result.type === 'batch_job') {
      jobId = result.jobId;
      estCount = result.estCount;
    } else {
      // Direct result from sync provider (e.g., vertex)
      jobId = `direct-${Date.now()}`;
      estCount = result.result.results.length;
      
      // For direct results, we're already done
      console.log('\n✅ Direct generation completed!');
      console.log(`   Provider: ${chosenProvider}`);
      console.log(`   Generated images: ${estCount}`);
      if (result.result.costPlan) {
        console.log(`   Estimated cost: $${result.result.costPlan.estimatedCost}`);
        console.log(`   Estimated time: ${result.result.costPlan.estimatedTime}`);
      }
      return;
    }

    // Create job manifest with extended metadata (for async batch jobs)
    const jobManifest: JobManifest & { 
      refMode?: string; 
      referencePackDigest?: string;
      preflight?: any;
    } = {
      jobId,
      provider: providerName as any,
      submittedAt: new Date().toISOString(),
      estCount,
      promptsHash: crypto.randomUUID(), // TODO: compute actual hash
      styleRefsHash: packDigest,
      statusHistory: [{
        timestamp: new Date().toISOString(),
        status: 'pending'
      }],
      problems: [],
      refMode: opts.refMode || 'style',
      referencePackDigest: packDigest,
      preflight: {
        chunks: preflightResult.chunks,
        uniqueRefs: preflightResult.uniqueRefs,
        bytes: preflightResult.bytes,
        compressed: opts.compress ?? true
      }
    };
    
    // Save job manifest
    const jobsDir = join(env.NN_OUT_DIR, 'jobs');
    await mkdir(jobsDir, { recursive: true });
    const manifestPath = join(jobsDir, `${jobId}.json`);
    await writeFile(manifestPath, JSON.stringify(jobManifest, null, 2));
    
    log.info({ 
      jobId,
      manifestPath 
    }, 'Job manifest saved');
    
    // Record in manifest
    await manifest.recordSuccess(
      'batch-submit',
      opts.promptsPath,
      manifestPath,
      {
        jobId,
        estCount,
        prompts: rows.length,
        styleRefs: styleRefs.length,
        variants: opts.variants,
        provider: chosenProvider
      }
    );
    
    logTiming(log, 'runBatchSubmit', startTime);
    
    console.log('\n✅ Batch job submitted!');
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Provider: ${chosenProvider}`);
    console.log(`   Estimated images: ${estCount}`);
    console.log(`   Manifest: ${manifestPath}`);
    console.log('\n   Poll status: nn batch poll --job ' + jobId);
    console.log('   Watch: nn batch poll --job ' + jobId + ' --watch');
    
  } catch (error) {
    log.error({ error }, 'Batch submit failed');
    
    // Record failure in manifest
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('batch-submit', opts.promptsPath, {
      type: 'about:blank',
      title: 'Batch submit failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: crypto.randomUUID()
    });
    
    throw error;
  }
}