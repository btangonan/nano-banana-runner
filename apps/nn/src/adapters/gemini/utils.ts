import { createOperationLogger } from '../../logger.js';

/**
 * Sleep utility for retry backoff
 * Extracted from geminiImage.ts for better modularity
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncated exponential backoff with full jitter
 * Provides robust retry logic for transient failures
 * @param fn - Function to retry
 * @param operation - Operation name for logging
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @returns Promise with the result of the function
 * @throws Error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  const log = createOperationLogger('withRetry');
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries - 1;
      
      // Don't retry on non-retryable errors
      if (error.status && error.status < 500 && error.status !== 429) {
        throw error;
      }
      
      if (isLastAttempt) {
        throw error;
      }
      
      // Calculate backoff with full jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
      const jitter = Math.random() * delay;
      
      log.debug({ 
        operation, 
        attempt: attempt + 1, 
        maxRetries, 
        jitterMs: Math.round(jitter) 
      }, 'Retrying with backoff');
      
      await sleep(jitter);
    }
  }
  
  throw new Error(`Retry exhausted for ${operation}`);
}

/**
 * Calculate appropriate concurrency level based on workload
 * @param totalItems - Total number of items to process
 * @param maxConcurrency - Maximum allowed concurrency
 * @returns Optimal concurrency level
 */
export function calculateConcurrency(
  totalItems: number,
  maxConcurrency: number = 4
): number {
  return Math.min(
    maxConcurrency,
    Math.ceil(totalItems / 3)
  );
}

/**
 * Create a controlled concurrency processor
 * @param items - Items to process
 * @param processor - Function to process each item
 * @param maxConcurrency - Maximum concurrent operations
 * @returns Promise that resolves when all items are processed
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const inProgress = new Set<Promise<void>>();
  
  for (const item of items) {
    // Wait if we're at max concurrency
    if (inProgress.size >= maxConcurrency) {
      await Promise.race(inProgress);
    }
    
    // Start new work item
    const work = processor(item)
      .then(result => {
        results.push(result);
      })
      .finally(() => {
        inProgress.delete(work);
      });
    
    inProgress.add(work);
  }
  
  // Wait for all remaining work
  await Promise.all(inProgress);
  
  return results;
}