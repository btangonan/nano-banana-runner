import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create a minimal test style image for smoke tests
 */
export async function createTestStyleImage(): Promise<string> {
  const testDir = join(process.cwd(), 'test', 'fixtures', 'styles');
  const imagePath = join(testDir, 'test-style.png');
  
  // Ensure directory exists
  await mkdir(testDir, { recursive: true });
  
  // Create a simple 64x64 test image with a blue square on white background
  const width = 64;
  const height = 64;
  const channels = 3;
  
  const imageBuffer = Buffer.alloc(width * height * channels);
  
  // Fill with white background (255, 255, 255)
  for (let i = 0; i < imageBuffer.length; i += 3) {
    imageBuffer[i] = 255;     // R
    imageBuffer[i + 1] = 255; // G  
    imageBuffer[i + 2] = 255; // B
  }
  
  // Add a blue square in the center (16x16)
  const squareSize = 16;
  const startX = (width - squareSize) / 2;
  const startY = (height - squareSize) / 2;
  
  for (let y = startY; y < startY + squareSize; y++) {
    for (let x = startX; x < startX + squareSize; x++) {
      const idx = (y * width + x) * channels;
      imageBuffer[idx] = 0;     // R
      imageBuffer[idx + 1] = 0; // G
      imageBuffer[idx + 2] = 255; // B (blue)
    }
  }
  
  // Convert raw buffer to PNG using Sharp
  const pngBuffer = await sharp(imageBuffer, {
    raw: { width, height, channels }
  }).png().toBuffer();
  
  // Save to file
  await writeFile(imagePath, pngBuffer);
  
  return imagePath;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createTestStyleImage()
    .then(path => console.log(`Created test image: ${path}`))
    .catch(error => {
      console.error('Failed to create test image:', error);
      process.exit(1);
    });
}