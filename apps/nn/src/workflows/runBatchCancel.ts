import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOperationLogger } from '../logger.js';
import { geminiBatchProvider } from '../adapters/geminiBatch.js';
import { JobManifest } from '../types.js';
import { env } from '../config/env.js';

interface BatchCancelOptions {
  jobId: string;
}

/**
 * Cancel batch job
 */
export async function runBatchCancel(opts: BatchCancelOptions): Promise<void> {
  const log = createOperationLogger('runBatchCancel');
  
  log.info({ jobId: opts.jobId }, 'Canceling batch job');
  
  try {
    // Cancel job
    const result = await geminiBatchProvider.cancel(opts.jobId);
    
    log.info({ 
      jobId: opts.jobId, 
      status: result.status 
    }, 'Cancel request complete');
    
    // Update job manifest if it exists
    const manifestPath = join(env.NN_OUT_DIR, 'jobs', `${opts.jobId}.json`);
    
    try {
      const content = await readFile(manifestPath, 'utf-8');
      const manifest: JobManifest = JSON.parse(content);
      
      // Add cancel status
      manifest.statusHistory.push({
        timestamp: new Date().toISOString(),
        status: 'canceled'
      });
      
      // Save updated manifest
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      
      log.info({ manifestPath }, 'Job manifest updated with cancel status');
      
    } catch {
      // Manifest not found, that's ok
      log.debug({ manifestPath }, 'Job manifest not found, skipping update');
    }
    
    // Display result
    if (result.status === 'canceled') {
      console.log(`\n✅ Job ${opts.jobId} canceled successfully`);
    } else if (result.status === 'not_found') {
      console.log(`\n⚠️  Job ${opts.jobId} not found (may have already completed or expired)`);
    } else {
      console.log(`\n❓ Job ${opts.jobId} cancel status: ${result.status}`);
    }
    
  } catch (error) {
    log.error({ jobId: opts.jobId, error }, 'Batch cancel failed');
    throw error;
  }
}