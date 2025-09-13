import sharp from 'sharp';
import { createOperationLogger } from '../logger.js';

/**
 * Style guard configuration with calibrated threshold
 */
export interface GuardConfig {
  hammingMax: number;  // Maximum Hamming distance to consider as "too similar"
}

/**
 * Default configuration (calibrated for style-only enforcement)
 */
export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  hammingMax: 15  // Calibrated: allows style similarity but blocks near-copies
};

/**
 * Generate a 64-bit perceptual hash for an image
 * Uses 8x8 DCT-like approach on 32x32 grayscale
 */
export async function pHash64(img: Buffer): Promise<bigint> {
  const log = createOperationLogger('pHash64');
  
  try {
    // Resize to 32x32 and convert to grayscale
    const { data } = await sharp(img)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Calculate average pixel value
    const pixels = new Uint8Array(data);
    const avg = pixels.reduce((sum, val) => sum + val, 0) / pixels.length;
    
    // Generate hash: 1 if pixel > average, 0 otherwise
    // Use first 64 pixels (8x8 grid sampled from 32x32)
    let hash = 0n;
    const step = Math.floor(pixels.length / 64);
    
    for (let i = 0; i < 64; i++) {
      const pixelIndex = i * step;
      const pixelValue = pixels[pixelIndex] || 0;
      
      // Shift left and add bit
      hash = (hash << 1n) | (pixelValue > avg ? 1n : 0n);
    }
    
    log.debug({ 
      imageSize: img.length, 
      avgBrightness: Math.round(avg),
      hashBits: hash.toString(2).padStart(64, '0')
    }, 'Generated perceptual hash');
    
    return hash;
  } catch (error) {
    log.error({ error }, 'Failed to generate perceptual hash');
    throw new Error(`Failed to generate perceptual hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Calculate Hamming distance between two hashes
 * (number of bit positions where the hashes differ)
 */
export function hamming(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  
  // Count set bits in XOR result
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  
  return count;
}

/**
 * Calculate similarity percentage (0-100)
 * 100 = identical, 0 = completely different
 */
export function similarity(a: bigint, b: bigint): number {
  const distance = hamming(a, b);
  // 64 bits total, so max distance is 64
  return Math.round((1 - distance / 64) * 100);
}

/**
 * Check if generated image passes style guard
 * Returns true if image is sufficiently different from all references
 * Returns false if too similar (potential copy)
 */
export async function passesStyleGuard(
  generated: Buffer,
  references: Buffer[],
  config: GuardConfig = DEFAULT_GUARD_CONFIG
): Promise<boolean> {
  const log = createOperationLogger('passesStyleGuard');
  
  if (references.length === 0) {
    log.warn('No reference images provided, passing by default');
    return true;
  }
  
  try {
    // Generate hash for the generated image
    const genHash = await pHash64(generated);
    
    // Check against each reference
    for (let i = 0; i < references.length; i++) {
      const refHash = await pHash64(references[i]!);
      const distance = hamming(genHash, refHash);
      const sim = similarity(genHash, refHash);
      
      log.debug({
        referenceIndex: i,
        hammingDistance: distance,
        similarity: `${sim}%`,
        threshold: config.hammingMax,
        willReject: distance <= config.hammingMax
      }, 'Comparing to reference image');
      
      // If too similar to any reference, reject
      if (distance <= config.hammingMax) {
        log.warn({
          referenceIndex: i,
          hammingDistance: distance,
          threshold: config.hammingMax,
          similarity: `${sim}%`
        }, 'Generated image too similar to reference (potential copy)');
        
        return false;
      }
    }
    
    log.info({
      referencesChecked: references.length,
      threshold: config.hammingMax
    }, 'Generated image passed style guard');
    
    return true;
    
  } catch (error) {
    log.error({ error }, 'Style guard check failed');
    // Fail closed - if we can't verify, assume it's a copy
    return false;
  }
}

/**
 * Load guard configuration from file
 */
export async function loadGuardConfig(path: string): Promise<GuardConfig> {
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const config = JSON.parse(content);
    
    if (typeof config.hammingMax !== 'number' || 
        config.hammingMax < 0 || 
        config.hammingMax > 64) {
      throw new Error('Invalid hammingMax value in config');
    }
    
    return config;
  } catch (error) {
    const log = createOperationLogger('loadGuardConfig');
    log.warn({ path, error }, 'Failed to load guard config, using defaults');
    return DEFAULT_GUARD_CONFIG;
  }
}

/**
 * Save guard configuration to file
 */
export async function saveGuardConfig(
  config: GuardConfig,
  path: string
): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  
  // Ensure directory exists
  await mkdir(dirname(path), { recursive: true });
  
  // Write config
  await writeFile(path, JSON.stringify(config, null, 2));
}

/**
 * Calibration result from threshold tuning
 */
export interface CalibrationResult {
  threshold: number;
  truePositives: number;   // Correctly identified copies
  falsePositives: number;  // Incorrectly flagged as copies
  trueNegatives: number;   // Correctly identified as different
  falseNegatives: number;  // Missed copies
  accuracy: number;        // Overall accuracy percentage
  fpr: number;            // False positive rate
  fnr: number;            // False negative rate
}

/**
 * Build style-only enforcement message
 */
export function buildStyleOnlyMessage() {
  return {
    role: 'system' as const,
    parts: [{
      text: 'Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, composition, or layout. Create original compositions inspired by the artistic style only.'
    }]
  };
}

/**
 * Enforce style-only conditioning on a request
 */
export function enforceStyleOnly(request: any) {
  const styleMessage = buildStyleOnlyMessage();
  
  return {
    ...request,
    contents: [
      styleMessage,
      ...(request.contents || [])
    ]
  };
}

/**
 * Validate that a prompt complies with style-only requirements
 */
export function validateStyleOnlyCompliance(prompt: string): { compliant: boolean; issues: string[] } {
  const issues: string[] = [];
  const lowerPrompt = prompt.toLowerCase();
  
  // Check for copying keywords
  const copyKeywords = [
    'exact copy', 'exact same', 'exactly like',
    'replicate', 'duplicate', 'mirror',
    'clone', 'identical', 'same as'
  ];
  
  for (const keyword of copyKeywords) {
    if (lowerPrompt.includes(keyword)) {
      issues.push('Prompt may encourage direct copying');
      break;
    }
  }
  
  return {
    compliant: issues.length === 0,
    issues
  };
}