import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createOperationLogger, logTiming } from '../logger.js';
import { geminiBatchProvider } from '../adapters/geminiBatch.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import { JobManifest } from '../types.js';
import { env } from '../config/env.js';

interface BatchFetchOptions {
  jobId: string;
  outDir: string;
}

/**
 * Fetch batch job results
 */
export async function runBatchFetch(opts: BatchFetchOptions): Promise<void> {
  const log = createOperationLogger('runBatchFetch');
  const startTime = Date.now();
  
  log.info({ jobId: opts.jobId, outDir: opts.outDir }, 'Starting batch fetch');
  
  try {
    // Check job status first
    const status = await geminiBatchProvider.poll(opts.jobId);
    
    if (status.status === 'pending' || status.status === 'running') {
      log.warn({ 
        jobId: opts.jobId, 
        status: status.status 
      }, 'Job not complete yet');
      
      console.log(`\n⏳ Job ${opts.jobId} is still ${status.status}`);
      console.log('   Use: nn batch poll --job ' + opts.jobId + ' --watch');
      return;
    }
    
    // Fetch results
    const result = await geminiBatchProvider.fetch(opts.jobId, opts.outDir);
    
    log.info({ 
      jobId: opts.jobId,
      successCount: result.results.length,
      problemCount: result.problems.length 
    }, 'Batch fetch complete');
    
    // Update job manifest
    const manifestPath = join(env.NN_OUT_DIR, 'jobs', `${opts.jobId}.json`);
    let manifest: JobManifest;
    
    try {
      const content = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch {
      // Create minimal manifest if not found
      manifest = {
        jobId: opts.jobId,
        provider: 'gemini-batch',
        submittedAt: new Date().toISOString(),
        estCount: result.results.length,
        statusHistory: [],
        problems: []
      };
    }
    
    // Add fetch status
    manifest.statusHistory.push({
      timestamp: new Date().toISOString(),
      status: 'succeeded',
      completed: result.results.length,
      total: result.results.length + result.problems.length
    });
    
    // Add problems
    if (result.problems.length > 0) {
      manifest.problems = [...(manifest.problems || []), ...result.problems];
    }
    
    // Save updated manifest
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    
    // Append to artifacts manifest
    const fsManifest = new FileSystemManifest();
    await mkdir(env.NN_OUT_DIR, { recursive: true });
    const artifactManifestPath = join(env.NN_OUT_DIR, 'manifest.jsonl');
    
    for (const item of result.results) {
      const entry = {
        id: item.id,
        timestamp: new Date().toISOString(),
        operation: 'batch-fetch' as const,
        input: opts.jobId,
        output: item.outPath,
        status: 'success' as const,
        metadata: {
          prompt: item.prompt,
          jobId: opts.jobId
        }
      };
      await appendFile(artifactManifestPath, JSON.stringify(entry) + '\n');
    }
    
    for (const problem of result.problems) {
      const entry = {
        id: problem.instance,
        timestamp: new Date().toISOString(),
        operation: 'batch-fetch' as const,
        input: opts.jobId,
        output: problem.detail || problem.title,
        status: 'failed' as const,
        metadata: {
          problem,
          jobId: opts.jobId
        }
      };
      await appendFile(artifactManifestPath, JSON.stringify(entry) + '\n');
    }
    
    // Record overall success/failure
    if (result.results.length > 0) {
      await fsManifest.recordSuccess(
        'batch-fetch',
        opts.jobId,
        opts.outDir,
        {
          jobId: opts.jobId,
          fetched: result.results.length,
          problems: result.problems.length
        }
      );
    }
    
    logTiming(log, 'runBatchFetch', startTime);
    
    // Display results
    console.log('\n📦 Batch Fetch Results:');
    console.log(`   Job ID: ${opts.jobId}`);
    console.log(`   ✅ Images saved: ${result.results.length}`);
    console.log(`   ❌ Problems: ${result.problems.length}`);
    console.log(`   Output directory: ${opts.outDir}`);
    
    if (result.problems.length > 0) {
      console.log('\n⚠️  Problems encountered:');
      result.problems.slice(0, 5).forEach(p => {
        console.log(`   - ${p.title}: ${p.detail}`);
      });
      if (result.problems.length > 5) {
        console.log(`   ... and ${result.problems.length - 5} more`);
      }
    }
    
  } catch (error) {
    log.error({ jobId: opts.jobId, error }, 'Batch fetch failed');
    
    // Record failure
    const manifest = new FileSystemManifest();
    await manifest.recordProblem('batch-fetch', opts.jobId, {
      type: 'about:blank',
      title: 'Batch fetch failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
      instance: crypto.randomUUID()
    });
    
    throw error;
  }
}