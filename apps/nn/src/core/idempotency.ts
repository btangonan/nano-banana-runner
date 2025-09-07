import { createHash } from 'node:crypto';

/**
 * Generate SHA256 hash of input string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate day bucket for idempotency keys (YYYY-MM-DD)
 */
export function dayBucket(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]!;
}

/**
 * Generate idempotency key for a prompt
 * Combines normalized prompt text with day bucket to ensure
 * same prompts on same day get same key
 */
export function generateIdempotencyKey(
  prompt: string,
  sourceImage: string,
  date: Date = new Date()
): string {
  const normalized = normalizeForKey(prompt);
  const bucket = dayBucket(date);
  const combined = `${normalized}:${sourceImage}:${bucket}`;
  return sha256(combined);
}

/**
 * Normalize text for consistent key generation
 */
export function normalizeForKey(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

/**
 * Generate file hash for deduplication
 * Uses first and last chunks for speed on large files
 */
export async function generateFileHash(
  buffer: Buffer,
  algorithm: 'sha256' | 'md5' = 'sha256'
): Promise<string> {
  const hash = createHash(algorithm);
  
  // For files > 10MB, sample first 1MB, middle 1MB, and last 1MB
  const size = buffer.length;
  const chunkSize = 1024 * 1024; // 1MB
  
  if (size > chunkSize * 10) {
    // Sample strategy for large files
    hash.update(buffer.subarray(0, chunkSize));
    const middleStart = Math.floor(size / 2) - chunkSize / 2;
    hash.update(buffer.subarray(middleStart, middleStart + chunkSize));
    hash.update(buffer.subarray(size - chunkSize));
  } else {
    // Full hash for smaller files
    hash.update(buffer);
  }
  
  return hash.digest('hex');
}

/**
 * Check if two hashes are similar (for style-only validation)
 * Returns similarity score 0-1 (1 = identical)
 */
export function hashSimilarity(hash1: string, hash2: string): number {
  if (hash1 === hash2) return 1;
  
  // Convert hex to binary and calculate Hamming distance
  const bin1 = BigInt(`0x${hash1}`);
  const bin2 = BigInt(`0x${hash2}`);
  
  let xor = bin1 ^ bin2;
  let distance = 0;
  
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  
  // Normalize to 0-1 range (assuming 256-bit hash)
  const maxDistance = hash1.length * 4; // 4 bits per hex char
  return 1 - (distance / maxDistance);
}

/**
 * Threshold for considering images too similar (potential copy)
 */
export const STYLE_COPY_THRESHOLD = 0.85;

/**
 * Check if hash similarity indicates potential style copying
 */
export function isStyleCopy(
  hash1: string,
  hash2: string,
  threshold: number = STYLE_COPY_THRESHOLD
): boolean {
  return hashSimilarity(hash1, hash2) > threshold;
}

/**
 * Generate cache key for operations
 */
export function generateCacheKey(
  operation: string,
  ...params: string[]
): string {
  const combined = [operation, ...params].join(':');
  return sha256(combined);
}