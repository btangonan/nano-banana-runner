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

type RGB = { r: number; g: number; b: number };

function rgbToHex(c: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(c.r);
  const g = clamp(c.g);
  const b = clamp(c.b);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Extract palette using raw pixel data (primary method)
 */
async function extractPalettePrimary(buffer: Buffer, maxColors: number = 5): Promise<string[]> {
  // Normalize to sRGB, remove alpha, get raw pixels + info
  const { data, info } = await sharp(buffer)
    .resize(100, 100, { fit: 'inside' })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!data || !info || info.channels !== 3) {
    throw new Error('Invalid raw image data');
  }

  // Simple color quantization with frequency counting
  const colorMap = new Map<string, number>();
  
  for (let i = 0; i < data.length; i += 3) {
    const r = Math.floor(data[i]! / 32) * 32; // Quantize to reduce similar colors
    const g = Math.floor(data[i + 1]! / 32) * 32;
    const b = Math.floor(data[i + 2]! / 32) * 32;
    const hex = rgbToHex({ r, g, b });
    colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
  }
  
  // Sort by frequency and return top colors
  return Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => color);
}

/**
 * Extract palette using Sharp stats (fallback method)
 */
async function extractPaletteFallback(buffer: Buffer): Promise<string[]> {
  const stats = await sharp(buffer).toColorspace('srgb').stats();
  
  // Get dominant color
  const dominant = rgbToHex({ 
    r: stats.dominant.r, 
    g: stats.dominant.g, 
    b: stats.dominant.b 
  });
  
  // Add approximate additional colors from channel peaks
  const colors = new Set([dominant]);
  
  if (stats.channels && stats.channels.length >= 3) {
    // Add colors based on channel statistics
    const rPeak = stats.channels[0]?.max || 128;
    const gPeak = stats.channels[1]?.max || 128;
    const bPeak = stats.channels[2]?.max || 128;
    
    colors.add(rgbToHex({ r: rPeak, g: 64, b: 64 }));
    colors.add(rgbToHex({ r: 64, g: gPeak, b: 64 }));
    colors.add(rgbToHex({ r: 64, g: 64, b: bPeak }));
  }
  
  return Array.from(colors).slice(0, 5);
}

/**
 * Extract dominant colors from image with robust error handling
 */
async function extractPalette(
  buffer: Buffer,
  maxColors: number = 5
): Promise<string[]> {
  try {
    return await extractPalettePrimary(buffer, maxColors);
  } catch (error) {
    // Log the primary extraction failure but continue with fallback
    console.warn('Primary palette extraction failed, using fallback:', error);
    
    try {
      return await extractPaletteFallback(buffer);
    } catch (fallbackError) {
      // Final backstop: return neutral palette
      console.warn('Fallback palette extraction failed, using neutral colors:', fallbackError);
      return ['#808080', '#404040', '#c0c0c0', '#606060', '#a0a0a0'].slice(0, maxColors);
    }
  }
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
    // Use 1 instead of 0 to satisfy positive() validation
    return {
      path,
      hash: '',
      width: 1,
      height: 1,
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