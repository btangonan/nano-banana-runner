import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOperationLogger } from '../logger.js';
import { geminiBatchProvider } from '../adapters/geminiBatch.js';
import { JobManifest } from '../types.js';
import { env } from '../config/env.js';

interface BatchPollOptions {
  jobId: string;
  watch: boolean;
}

/**
 * Poll batch job status
 */
export async function runBatchPoll(opts: BatchPollOptions): Promise<string> {
  const log = createOperationLogger('runBatchPoll');
  
  log.info({ jobId: opts.jobId, watch: opts.watch }, 'Starting batch poll');
  
  try {
    // Load job manifest
    const manifestPath = join(env.NN_OUT_DIR, 'jobs', `${opts.jobId}.json`);
    let manifest: JobManifest;
    
    try {
      const content = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch {
      // If no manifest, create minimal one
      manifest = {
        jobId: opts.jobId,
        provider: 'gemini-batch',
        submittedAt: new Date().toISOString(),
        estCount: 0,
        statusHistory: [],
        problems: []
      };
    }
    
    let lastStatus: string | undefined;
    let pollCount = 0;
    const maxPolls = 1000; // Safety limit
    
    do {
      pollCount++;
      
      // Poll status
      const result = await geminiBatchProvider.poll(opts.jobId);
      
      // Update manifest
      if (result.status !== lastStatus) {
        manifest.statusHistory.push({
          timestamp: new Date().toISOString(),
          status: result.status,
          completed: result.completed,
          total: result.total
        });
        
        // Save updated manifest
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        lastStatus = result.status;
      }
      
      // Display progress
      const progress = result.total 
        ? `${result.completed ?? 0}/${result.total}` 
        : `${result.completed ?? 0} completed`;
      
      console.log(`[${new Date().toISOString()}] Job ${opts.jobId}: ${result.status} (${progress})`);
      
      // Check for errors
      if (result.errors && result.errors.length > 0) {
        log.warn({ 
          jobId: opts.jobId, 
          errorCount: result.errors.length 
        }, 'Job has errors');
        
        // Add to manifest problems
        if (manifest.problems) {
          manifest.problems.push(...result.errors);
        }
      }
      
      // Check if terminal state
      if (result.status === 'succeeded' || result.status === 'failed' || result.status === 'canceled') {
        log.info({ 
          jobId: opts.jobId, 
          finalStatus: result.status,
          completed: result.completed,
          total: result.total
        }, 'Job reached terminal state');
        
        if (result.status === 'succeeded') {
          console.log('\n✅ Job completed successfully!');
          console.log('   Fetch results: nn batch fetch --job ' + opts.jobId);
        } else if (result.status === 'failed') {
          console.log('\n❌ Job failed');
          if (result.errors && result.errors.length > 0) {
            console.log('   Errors:');
            result.errors.forEach(err => {
              console.log(`   - ${err.detail || err.title}`);
            });
          }
        }
        
        return result.status;
      }
      
      // If not watching, return current status
      if (!opts.watch) {
        return result.status;
      }
      
      // Wait before next poll (exponential backoff)
      const delay = Math.min(2000 * Math.pow(1.5, Math.min(pollCount, 10)), 30000);
      log.debug({ delay }, 'Waiting before next poll');
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } while (opts.watch && pollCount < maxPolls);
    
    if (pollCount >= maxPolls) {
      throw new Error(`Poll limit exceeded (${maxPolls} attempts)`);
    }
    
    return lastStatus || 'unknown';
    
  } catch (error) {
    log.error({ jobId: opts.jobId, error }, 'Batch poll failed');
    throw error;
  }
}