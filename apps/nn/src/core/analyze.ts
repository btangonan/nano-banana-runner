import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ImageDescriptor } from '../types.js';
import { generateFileHash } from './idempotency.js';
import { createOperationLogger, logTiming } from '../logger.js';

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Check if file is a supported image format
 */
export function isSupportedImage(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return SUPPORTED_FORMATS.has(ext);
}

/**
 * Extract dominant colors from image using k-means quantization
 */
async function extractPalette(
  buffer: Buffer,
  maxColors: number = 5
): Promise<string[]> {
  const { dominant } = await sharp(buffer)
    .resize(100, 100, { fit: 'inside' }) // Resize for faster processing
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Simple color quantization (k-means would be more accurate but heavier)
  const pixels = new Uint8Array(dominant.data);
  const colorMap = new Map<string, number>();
  
  for (let i = 0; i < pixels.length; i += dominant.info.channels) {
    const r = Math.floor(pixels[i]! / 32) * 32; // Quantize to 3 bits
    const g = Math.floor(pixels[i + 1]! / 32) * 32;
    const b = Math.floor(pixels[i + 2]! / 32) * 32;
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
  }
  
  // Sort by frequency and return top colors
  return Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => color);
}

/**
 * Extract basic subjects from filename (placeholder for model-based tagging)
 */
function extractSubjectsFromFilename(filename: string): string[] {
  const name = basename(filename, extname(filename));
  const words = name
    .replace(/[-_]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  // Basic subject keywords (TODO: replace with model-based tagging)
  const subjectKeywords = new Set([
    'portrait', 'landscape', 'nature', 'city', 'urban', 'people',
    'animal', 'food', 'abstract', 'architecture', 'sunset', 'ocean',
    'mountain', 'forest', 'street', 'night', 'day', 'sky'
  ]);
  
  return words.filter(w => subjectKeywords.has(w));
}

/**
 * Infer style attributes (placeholder for model-based analysis)
 */
function inferStyle(metadata: sharp.Metadata, palette: string[]): string[] {
  const styles: string[] = [];
  
  // Aspect ratio hints
  const aspectRatio = metadata.width! / metadata.height!;
  if (aspectRatio > 1.5) styles.push('wide');
  if (aspectRatio < 0.67) styles.push('tall');
  if (Math.abs(aspectRatio - 1) < 0.1) styles.push('square');
  
  // Color palette hints
  const avgBrightness = palette.reduce((sum, color) => {
    const rgb = parseInt(color.slice(1), 16);
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    return sum + (r + g + b) / 3;
  }, 0) / palette.length;
  
  if (avgBrightness < 85) styles.push('dark');
  if (avgBrightness > 170) styles.push('bright');
  
  // Saturation hints (simplified)
  const hasSaturated = palette.some(color => {
    const rgb = parseInt(color.slice(1), 16);
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return (max - min) > 100;
  });
  
  if (hasSaturated) styles.push('vibrant');
  else styles.push('muted');
  
  return styles;
}

/**
 * Infer lighting conditions (placeholder for model-based analysis)
 */
function inferLighting(metadata: sharp.Metadata, palette: string[]): string[] {
  const lighting: string[] = [];
  
  // Basic inference from metadata
  if (metadata.density && metadata.density > 150) {
    lighting.push('high-quality');
  }
  
  // Infer from palette
  const hasHighContrast = palette.length > 1 && 
    Math.abs(
      parseInt(palette[0]!.slice(1), 16) - 
      parseInt(palette[palette.length - 1]!.slice(1), 16)
    ) > 0x808080;
  
  if (hasHighContrast) {
    lighting.push('high-contrast');
  } else {
    lighting.push('soft');
  }
  
  return lighting;
}

/**
 * Analyze a single image and extract descriptor
 */
export async function analyzeImage(path: string): Promise<ImageDescriptor> {
  const log = createOperationLogger('analyzeImage', { path });
  const startTime = Date.now();
  
  try {
    if (!isSupportedImage(path)) {
      throw new Error(`Unsupported image format: ${extname(path)}`);
    }
    
    // Read file
    const buffer = await readFile(path);
    
    // Get metadata and generate hash in parallel
    const [metadata, hash, palette] = await Promise.all([
      sharp(buffer).metadata(),
      generateFileHash(buffer),
      extractPalette(buffer),
    ]);
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to extract image dimensions');
    }
    
    // Extract attributes (placeholders for now)
    const subjects = extractSubjectsFromFilename(path);
    const style = inferStyle(metadata, palette);
    const lighting = inferLighting(metadata, palette);
    
    const descriptor: ImageDescriptor = {
      path,
      hash,
      width: metadata.width,
      height: metadata.height,
      palette,
      subjects,
      style,
      lighting,
    };
    
    // Add camera info if available in EXIF
    if (metadata.exif) {
      // Note: Full EXIF parsing would require additional library
      descriptor.camera = {
        // Placeholder values
        lens: 'unknown',
        f: 2.8,
      };
    }
    
    logTiming(log, 'analyzeImage', startTime);
    return descriptor;
    
  } catch (error) {
    log.error({ error }, 'Failed to analyze image');
    
    // Return partial descriptor with error
    return {
      path,
      hash: '',
      width: 0,
      height: 0,
      palette: [],
      subjects: [],
      style: [],
      lighting: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Batch analyze multiple images with concurrency control
 */
export async function analyzeImages(
  paths: string[],
  concurrency: number = 4
): Promise<ImageDescriptor[]> {
  const log = createOperationLogger('analyzeImages', { count: paths.length });
  const startTime = Date.now();
  
  const results: ImageDescriptor[] = [];
  const queue = [...paths];
  const inProgress = new Set<Promise<void>>();
  
  while (queue.length > 0 || inProgress.size > 0) {
    // Start new tasks up to concurrency limit
    while (queue.length > 0 && inProgress.size < concurrency) {
      const path = queue.shift()!;
      const task = analyzeImage(path).then(descriptor => {
        results.push(descriptor);
        inProgress.delete(task);
      });
      inProgress.add(task);
    }
    
    // Wait for at least one task to complete
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }
  
  logTiming(log, 'analyzeImages', startTime);
  log.info({ 
    total: paths.length, 
    successful: results.filter(r => !r.errors).length 
  }, 'Batch analysis complete');
  
  return results;
}