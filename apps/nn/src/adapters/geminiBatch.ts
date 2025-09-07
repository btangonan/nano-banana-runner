import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AsyncImageGenProvider, PromptRow, Problem } from '../types.js';
import { BatchRelayClient } from './batchRelayClient.js';
import { createOperationLogger } from '../logger.js';
import { env } from '../config/env.js';
import { passesStyleGuard } from '../core/styleGuard.js';
import { STYLE_ONLY_PREFIX } from '../core/remix.js';

/**
 * Gemini Batch provider using relay proxy for secure API key handling
 * Implements async batch operations: submit -> poll -> fetch
 */
export class GeminiBatchAdapter implements AsyncImageGenProvider {
  private client: BatchRelayClient;
  private log = createOperationLogger('GeminiBatchAdapter');
  
  constructor() {
    const relayUrl = env.NN_BATCH_RELAY ?? 'http://127.0.0.1:8787';
    this.client = new BatchRelayClient(relayUrl);
    this.log.info({ relayUrl }, 'Initialized Gemini Batch adapter');
  }
  
  /**
   * Submit batch job to Gemini via relay
   */
  async submit(req: { 
    rows: PromptRow[]; 
    variants: 1 | 2 | 3; 
    styleOnly: true; 
    styleRefs: string[]; 
  }): Promise<{ jobId: string; estCount: number }> {
    this.log.info({ 
      rowCount: req.rows.length, 
      variants: req.variants,
      styleRefCount: req.styleRefs.length 
    }, 'Submitting batch job');
    
    // Transform prompt rows for batch API
    const batchRows = req.rows.map(row => ({
      prompt: `${STYLE_ONLY_PREFIX}\n\n${row.prompt}`,
      sourceImage: row.sourceImage,
      seed: row.seed,
      tags: row.tags
    }));
    
    try {
      const result = await this.client.submit({
        rows: batchRows,
        variants: req.variants,
        styleOnly: true,
        styleRefs: req.styleRefs
      });
      
      this.log.info({ 
        jobId: result.jobId, 
        estCount: result.estCount 
      }, 'Batch job submitted successfully');
      
      return result;
    } catch (error) {
      this.log.error({ error }, 'Failed to submit batch job');
      throw error;
    }
  }
  
  /**
   * Poll job status
   */
  async poll(jobId: string): Promise<{ 
    status: 'pending' | 'running' | 'succeeded' | 'failed'; 
    completed?: number; 
    total?: number; 
    errors?: Problem[] 
  }> {
    this.log.debug({ jobId }, 'Polling batch job status');
    
    try {
      const result = await this.client.poll(jobId);
      
      // Map any errors to Problem format
      const problems: Problem[] = (result.errors ?? []).map(err => ({
        type: 'about:blank',
        title: 'Batch processing error',
        detail: typeof err === 'string' ? err : JSON.stringify(err),
        status: 500,
        instance: crypto.randomUUID()
      }));
      
      return {
        status: result.status,
        completed: result.completed,
        total: result.total,
        errors: problems.length > 0 ? problems : undefined
      };
    } catch (error) {
      this.log.error({ jobId, error }, 'Failed to poll batch job');
      throw error;
    }
  }
  
  /**
   * Fetch and process job results
   */
  async fetch(jobId: string, outDir: string): Promise<{ 
    results: Array<{ id: string; prompt: string; outPath: string }>; 
    problems: Problem[] 
  }> {
    this.log.info({ jobId, outDir }, 'Fetching batch results');
    
    try {
      // Ensure output directory exists
      await mkdir(outDir, { recursive: true });
      
      // Fetch results from relay
      const batchResults = await this.client.fetch(jobId);
      
      const results: Array<{ id: string; prompt: string; outPath: string }> = [];
      const problems: Problem[] = [];
      
      // Load style references for validation (if configured)
      const styleRefs: Buffer[] = [];
      if (env.NN_STYLE_GUARD_ENABLED === true) {
        // TODO: Load style refs from job manifest or config
        this.log.debug('Style guard enabled but refs not available in fetch context');
      }
      
      // Process each result
      for (const item of batchResults.results) {
        try {
          // Skip if no image data
          if (!item.outUrl) {
            problems.push({
              type: 'about:blank',
              title: 'Missing image data',
              detail: `No image generated for prompt: ${item.prompt}`,
              status: 404,
              instance: crypto.randomUUID()
            });
            continue;
          }
          
          // Extract base64 data from data URL
          let imageBuffer: Buffer;
          if (item.outUrl.startsWith('data:')) {
            const base64Data = item.outUrl.split(',')[1];
            if (!base64Data) {
              throw new Error('Invalid data URL format');
            }
            imageBuffer = Buffer.from(base64Data, 'base64');
          } else {
            // If it's a URL, we'd need to download it
            // For now, skip with error
            problems.push({
              type: 'about:blank',
              title: 'Remote URL not supported',
              detail: `Cannot fetch remote image: ${item.outUrl}`,
              status: 501,
              instance: crypto.randomUUID()
            });
            continue;
          }
          
          // Style guard validation if refs available
          if (styleRefs.length > 0) {
            const passes = await passesStyleGuard(imageBuffer, styleRefs);
            if (!passes) {
              this.log.warn({ id: item.id }, 'Image failed style guard');
              problems.push({
                type: 'about:blank',
                title: 'Style validation failed',
                detail: `Image too similar to style reference: ${item.id}`,
                status: 422,
                instance: crypto.randomUUID()
              });
              continue;
            }
          }
          
          // Save image atomically
          const filename = `${item.id}.png`;
          const outPath = join(outDir, filename);
          const tmpPath = `${outPath}.tmp`;
          
          await writeFile(tmpPath, imageBuffer);
          await import('node:fs/promises').then(fs => fs.rename(tmpPath, outPath));
          
          results.push({
            id: item.id,
            prompt: item.prompt,
            outPath
          });
          
          this.log.debug({ id: item.id, outPath }, 'Saved image');
          
        } catch (error) {
          this.log.error({ id: item.id, error }, 'Failed to process result');
          problems.push({
            type: 'about:blank',
            title: 'Processing failed',
            detail: error instanceof Error ? error.message : 'Unknown error',
            status: 500,
            instance: crypto.randomUUID()
          });
        }
      }
      
      // Add batch-level problems
      for (const problem of batchResults.problems) {
        problems.push({
          type: problem.type ?? 'about:blank',
          title: problem.title ?? 'Batch error',
          detail: problem.detail ?? JSON.stringify(problem),
          status: problem.status ?? 500,
          instance: problem.instance ?? crypto.randomUUID()
        });
      }
      
      this.log.info({ 
        jobId, 
        successCount: results.length, 
        problemCount: problems.length 
      }, 'Batch fetch complete');
      
      return { results, problems };
      
    } catch (error) {
      this.log.error({ jobId, error }, 'Failed to fetch batch results');
      throw error;
    }
  }
  
  /**
   * Cancel batch job
   */
  async cancel(jobId: string): Promise<{ status: 'canceled' | 'not_found' }> {
    this.log.info({ jobId }, 'Canceling batch job');
    
    try {
      const result = await this.client.cancel(jobId);
      this.log.info({ jobId, status: result.status }, 'Batch cancel complete');
      return result;
    } catch (error) {
      this.log.error({ jobId, error }, 'Failed to cancel batch job');
      throw error;
    }
  }
}

// Export singleton instance
export const geminiBatchProvider = new GeminiBatchAdapter();