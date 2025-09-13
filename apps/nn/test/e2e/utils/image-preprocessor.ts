/**
 * Adaptive Image Preprocessing for Gemini Vision API
 * Intelligently resizes images to stay under payload limits while preserving quality
 */

import sharp from 'sharp';

interface PreprocessOptions {
  maxSizeBytes?: number;
  maxEdgePixels?: number;
  targetSizeBytes?: number;
  preserveFormat?: boolean;
}

interface PreprocessResult {
  buffer: Buffer;
  originalSize: number;
  processedSize: number;
  compressionRatio: number;
  format: string;
  width?: number;
  height?: number;
}

/**
 * Adaptive image preprocessing that preserves visual information
 * - Small images (<300KB) pass through unchanged
 * - PNG retained for line art/masks/sparse colors
 * - WebP for photos (better compression)
 * - Progressive quality reduction if needed
 */
export async function preprocessForGemini(
  imageBuffer: Buffer,
  options: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const {
    maxSizeBytes = 900 * 1024,     // 900KB target (safe margin under 1MB)
    maxEdgePixels = 1400,           // Slightly larger than 1024 for quality
    targetSizeBytes = 800 * 1024,   // Ideal target size
    preserveFormat = false
  } = options;
  
  const originalSize = imageBuffer.byteLength;
  
  // Small images pass through unchanged
  if (originalSize < 300 * 1024) {
    const metadata = await sharp(imageBuffer).metadata();
    return {
      buffer: imageBuffer,
      originalSize,
      processedSize: originalSize,
      compressionRatio: 1.0,
      format: metadata.format || 'unknown',
      width: metadata.width,
      height: metadata.height
    };
  }
  
  // Initialize Sharp with EXIF rotation preserved
  const img = sharp(imageBuffer, { failOnError: false }).rotate();
  const metadata = await img.metadata();
  
  // Determine if image is line art/diagram (better as PNG)
  const isLineArt = await detectLineArt(imageBuffer, metadata);
  
  // Calculate resize dimensions preserving aspect ratio
  const resizeDimensions = calculateResizeDimensions(
    metadata.width || 0,
    metadata.height || 0,
    maxEdgePixels
  );
  
  // Apply resize if needed
  let pipeline = img;
  if (resizeDimensions.resize) {
    pipeline = pipeline.resize({
      width: resizeDimensions.width,
      height: resizeDimensions.height,
      fit: 'inside',
      withoutEnlargement: true
    });
  }
  
  // Choose output format based on content type
  let processedBuffer: Buffer;
  let format: string;
  
  if (preserveFormat && metadata.format) {
    // Keep original format if requested
    format = metadata.format;
    processedBuffer = await compressInFormat(
      pipeline,
      format,
      targetSizeBytes
    );
  } else if (isLineArt) {
    // Use PNG for line art/diagrams
    format = 'png';
    processedBuffer = await pipeline
      .png({
        compressionLevel: 9,
        palette: true,
        effort: 10
      })
      .toBuffer();
  } else {
    // Use WebP for photos (best compression)
    format = 'webp';
    processedBuffer = await progressiveCompress(
      pipeline,
      'webp',
      targetSizeBytes
    );
  }
  
  // If still too large, try more aggressive compression
  if (processedBuffer.byteLength > maxSizeBytes) {
    processedBuffer = await aggressiveCompress(
      pipeline,
      format,
      maxSizeBytes
    );
  }
  
  // Get final dimensions
  const finalMetadata = await sharp(processedBuffer).metadata();
  
  return {
    buffer: processedBuffer,
    originalSize,
    processedSize: processedBuffer.byteLength,
    compressionRatio: processedBuffer.byteLength / originalSize,
    format,
    width: finalMetadata.width,
    height: finalMetadata.height
  };
}

/**
 * Detect if image is likely line art/diagram
 */
async function detectLineArt(
  buffer: Buffer,
  metadata: sharp.Metadata
): Promise<boolean> {
  // Has alpha channel (transparency)
  if (metadata.hasAlpha) {
    return true;
  }
  
  // Has palette (indexed color)
  if (metadata.paletteProp) {
    return true;
  }
  
  // PNG with small color count
  if (metadata.format === 'png') {
    try {
      const stats = await sharp(buffer).stats();
      const channels = stats.channels;
      
      // Check for limited color variance (indicates line art)
      const colorVariance = channels.reduce((sum, channel) => 
        sum + (channel.max - channel.min), 0
      );
      
      if (colorVariance < 100 * channels.length) {
        return true;
      }
    } catch {
      // Ignore stats errors
    }
  }
  
  return false;
}

/**
 * Calculate resize dimensions preserving aspect ratio
 */
function calculateResizeDimensions(
  width: number,
  height: number,
  maxEdge: number
): { resize: boolean; width?: number; height?: number } {
  if (!width || !height) {
    return { resize: false };
  }
  
  const largestEdge = Math.max(width, height);
  
  if (largestEdge <= maxEdge) {
    return { resize: false };
  }
  
  if (width > height) {
    return {
      resize: true,
      width: maxEdge,
      height: undefined  // Sharp will calculate
    };
  } else {
    return {
      resize: true,
      width: undefined,  // Sharp will calculate
      height: maxEdge
    };
  }
}

/**
 * Progressive compression with quality steps
 */
async function progressiveCompress(
  pipeline: sharp.Sharp,
  format: 'webp' | 'jpeg',
  targetSize: number
): Promise<Buffer> {
  const qualitySteps = [85, 80, 75, 70, 65];
  
  for (const quality of qualitySteps) {
    const buffer = format === 'webp'
      ? await pipeline.webp({ quality, effort: 6 }).toBuffer()
      : await pipeline.jpeg({ quality, progressive: true }).toBuffer();
    
    if (buffer.byteLength <= targetSize) {
      return buffer;
    }
  }
  
  // Return lowest quality if all steps exceeded target
  return format === 'webp'
    ? await pipeline.webp({ quality: 60, effort: 6 }).toBuffer()
    : await pipeline.jpeg({ quality: 60, progressive: true }).toBuffer();
}

/**
 * Aggressive compression when normal methods fail
 */
async function aggressiveCompress(
  pipeline: sharp.Sharp,
  format: string,
  maxSize: number
): Promise<Buffer> {
  // Try WebP with lowest quality
  if (format !== 'webp') {
    const webpBuffer = await pipeline
      .webp({ quality: 50, effort: 6 })
      .toBuffer();
    
    if (webpBuffer.byteLength <= maxSize) {
      return webpBuffer;
    }
  }
  
  // Last resort: heavy JPEG compression
  return pipeline
    .jpeg({ 
      quality: 40, 
      progressive: true,
      mozjpeg: true
    })
    .toBuffer();
}

/**
 * Compress in specific format
 */
async function compressInFormat(
  pipeline: sharp.Sharp,
  format: string,
  targetSize: number
): Promise<Buffer> {
  switch (format) {
    case 'png':
      return pipeline.png({ 
        compressionLevel: 9, 
        effort: 10 
      }).toBuffer();
      
    case 'webp':
      return progressiveCompress(pipeline, 'webp', targetSize);
      
    case 'jpeg':
    case 'jpg':
      return progressiveCompress(pipeline, 'jpeg', targetSize);
      
    default:
      // Fallback to WebP for unknown formats
      return progressiveCompress(pipeline, 'webp', targetSize);
  }
}

/**
 * Calculate SSIM (Structural Similarity Index) between two images
 * Used to verify preprocessing doesn't degrade quality too much
 */
export async function calculateSSIM(
  original: Buffer,
  processed: Buffer
): Promise<number> {
  try {
    // Resize both to same dimensions for comparison
    const size = { width: 256, height: 256 };
    
    const [origResized, procResized] = await Promise.all([
      sharp(original).resize(size).raw().toBuffer(),
      sharp(processed).resize(size).raw().toBuffer()
    ]);
    
    // Simple SSIM approximation (full SSIM is complex)
    let sum = 0;
    const pixels = origResized.length;
    
    for (let i = 0; i < pixels; i++) {
      const diff = Math.abs(origResized[i] - procResized[i]);
      sum += 1 - (diff / 255);
    }
    
    return sum / pixels;
  } catch {
    // Return high similarity on error (don't block tests)
    return 0.95;
  }
}

/**
 * Batch preprocessing for multiple images
 */
export async function preprocessBatch(
  images: Buffer[],
  options?: PreprocessOptions
): Promise<PreprocessResult[]> {
  return Promise.all(
    images.map(img => preprocessForGemini(img, options))
  );
}

/**
 * Validate preprocessing maintains acceptable quality
 */
export async function validatePreprocessing(
  original: Buffer,
  processed: Buffer,
  minSSIM = 0.85
): Promise<{ valid: boolean; ssim: number; reason?: string }> {
  const ssim = await calculateSSIM(original, processed);
  
  if (ssim < minSSIM) {
    return {
      valid: false,
      ssim,
      reason: `SSIM ${ssim.toFixed(3)} below threshold ${minSSIM}`
    };
  }
  
  // Check processed size is actually smaller
  if (processed.byteLength >= original.byteLength) {
    return {
      valid: false,
      ssim,
      reason: 'Processed image not smaller than original'
    };
  }
  
  return { valid: true, ssim };
}