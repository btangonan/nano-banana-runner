import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SharpProvider, isSupportedImage } from '../../src/core/providers/sharp.js';
import type { ImageDescriptor } from '../../src/core/providers/types.js';

describe('SharpProvider', () => {
  let provider: SharpProvider;

  beforeEach(() => {
    provider = new SharpProvider();
  });

  describe('isSupportedImage', () => {
    it('should support common image formats', () => {
      expect(isSupportedImage('test.jpg')).toBe(true);
      expect(isSupportedImage('test.jpeg')).toBe(true);
      expect(isSupportedImage('test.png')).toBe(true);
      expect(isSupportedImage('test.webp')).toBe(true);
    });

    it('should handle case insensitive extensions', () => {
      expect(isSupportedImage('test.JPG')).toBe(true);
      expect(isSupportedImage('test.JPEG')).toBe(true);
      expect(isSupportedImage('test.PNG')).toBe(true);
    });

    it('should reject unsupported formats', () => {
      expect(isSupportedImage('test.txt')).toBe(false);
      expect(isSupportedImage('test.pdf')).toBe(false);
      expect(isSupportedImage('test.gif')).toBe(false);
      expect(isSupportedImage('test')).toBe(false);
    });
  });

  describe('provider configuration', () => {
    it('should have correct name and default config', () => {
      expect(provider.name).toBe('sharp');
      expect(provider.config.maxImagesPerBatch).toBe(64);
      expect(provider.config.timeoutMs).toBe(5000);
      expect(provider.config.costPerImage).toBe(0);
    });

    it('should accept custom configuration', () => {
      const customProvider = new SharpProvider({
        maxImagesPerBatch: 32,
        timeoutMs: 10000,
      });
      
      expect(customProvider.config.maxImagesPerBatch).toBe(32);
      expect(customProvider.config.timeoutMs).toBe(10000);
      expect(customProvider.config.costPerImage).toBe(0); // Should keep default
    });
  });

  describe('validateConfig', () => {
    it('should validate Sharp functionality', async () => {
      const isValid = await provider.validateConfig();
      expect(isValid).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('should return zero cost for Sharp provider', async () => {
      const estimate = await provider.estimateCost(10);
      
      expect(estimate.imageCount).toBe(10);
      expect(estimate.estimatedCost).toBe(0);
      expect(estimate.provider).toBe('sharp');
      expect(estimate.estimatedTimeMs).toBe(1000); // 10 * 100ms
    });
  });

  describe('analyze', () => {
    // Create minimal valid PNG buffer for testing
    const createTestPNG = (): Buffer => Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, // 2x2 image
      0x08, 0x02, 0x00, 0x00, 0x00, 0xFD, 0xD5, 0x9A,
      0x20, 0x00, 0x00, 0x00, 0x12, 0x49, 0x44, 0x41,
      0x54, 0x08, 0x99, 0x01, 0x07, 0x00, 0xF8, 0xFF,
      0xFF, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
      0x60, 0x82
    ]);

    it('should analyze a valid image buffer', async () => {
      const testBuffer = createTestPNG();
      const result = await provider.analyze('test.png', testBuffer);
      
      expect(result.provider).toBe('sharp');
      expect(result.path).toBe('test.png');
      expect(result.width).toBe(2);
      expect(result.height).toBe(2);
      expect(result.format).toBe('png');
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA256 hex length
      expect(result.palette).toBeInstanceOf(Array);
      expect(result.subjects).toBeInstanceOf(Array);
      expect(result.style).toBeInstanceOf(Array);
      expect(result.lighting).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('should extract subjects from filename', async () => {
      const testBuffer = createTestPNG();
      const result = await provider.analyze('sunset-landscape-nature.png', testBuffer);
      
      expect(result.subjects).toContain('sunset');
      expect(result.subjects).toContain('landscape');
      expect(result.subjects).toContain('nature');
    });

    it('should infer style from image properties', async () => {
      const testBuffer = createTestPNG();
      const result = await provider.analyze('test.png', testBuffer);
      
      expect(result.style).toBeInstanceOf(Array);
      expect(result.style?.length).toBeGreaterThan(0);
      expect(result.style).toContain('square'); // 2x2 image is square
    });

    it('should handle unsupported image formats gracefully', async () => {
      const testBuffer = Buffer.from('not an image');
      const result = await provider.analyze('test.txt', testBuffer);
      
      expect(result.provider).toBe('sharp');
      expect(result.path).toBe('test.txt');
      expect(result.errors).toBeDefined();
      expect(result.errors).toContain('Unsupported image format: .txt');
      expect(result.width).toBe(1); // Fallback values
      expect(result.height).toBe(1);
    });

    it('should handle corrupted image buffers gracefully', async () => {
      const corruptedBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // Incomplete PNG
      const result = await provider.analyze('corrupt.png', corruptedBuffer);
      
      expect(result.provider).toBe('sharp');
      expect(result.path).toBe('corrupt.png');
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeBatch', () => {
    it('should analyze multiple images in batch', async () => {
      const testBuffer = createTestPNG();
      const items = [
        { path: 'test1.png', buffer: testBuffer },
        { path: 'test2.png', buffer: testBuffer },
        { path: 'test3.png', buffer: testBuffer },
      ];
      
      const results = await provider.analyzeBatch(items);
      
      expect(results).toHaveLength(3);
      expect(results[0]?.path).toBe('test1.png');
      expect(results[1]?.path).toBe('test2.png');
      expect(results[2]?.path).toBe('test3.png');
      
      // All should be successfully analyzed
      results.forEach(result => {
        expect(result.provider).toBe('sharp');
        expect(result.width).toBe(2);
        expect(result.height).toBe(2);
        expect(result.errors).toBeUndefined();
      });
    });

    it('should respect batch size limits', async () => {
      const smallProvider = new SharpProvider({ maxImagesPerBatch: 2 });
      const testBuffer = createTestPNG();
      const items = [
        { path: 'test1.png', buffer: testBuffer },
        { path: 'test2.png', buffer: testBuffer },
        { path: 'test3.png', buffer: testBuffer },
      ];
      
      await expect(smallProvider.analyzeBatch(items))
        .rejects.toThrow('Batch size 3 exceeds limit 2');
    });

    it('should handle mixed valid and invalid images', async () => {
      const validBuffer = createTestPNG();
      const invalidBuffer = Buffer.from('not an image');
      const items = [
        { path: 'valid.png', buffer: validBuffer },
        { path: 'invalid.txt', buffer: invalidBuffer },
        { path: 'valid2.png', buffer: validBuffer },
      ];
      
      const results = await provider.analyzeBatch(items);
      
      expect(results).toHaveLength(3);
      expect(results[0]?.errors).toBeUndefined();
      expect(results[1]?.errors).toBeDefined();
      expect(results[2]?.errors).toBeUndefined();
    });
  });

  describe('metrics', () => {
    it('should track request metrics', async () => {
      const testBuffer = createTestPNG();
      
      // Reset metrics
      provider.resetMetrics();
      const initialMetrics = provider.getMetrics();
      expect(initialMetrics.requestsTotal).toBe(0);
      
      // Make some requests
      await provider.analyze('test1.png', testBuffer);
      await provider.analyze('test2.png', testBuffer);
      
      const metricsAfter = provider.getMetrics();
      expect(metricsAfter.requestsTotal).toBe(2);
      expect(metricsAfter.latencyHistogram).toHaveLength(2);
      expect(metricsAfter.failuresTotal).toBe(0);
    });

    it('should track failure metrics', async () => {
      const invalidBuffer = Buffer.from('invalid');
      
      provider.resetMetrics();
      await provider.analyze('invalid.txt', invalidBuffer);
      
      const metrics = provider.getMetrics();
      expect(metrics.requestsTotal).toBe(1);
      expect(metrics.failuresTotal).toBe(1);
    });
  });
});

// Helper function to create test PNG buffer
function createTestPNG(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xFD, 0xD5, 0x9A,
    0x20, 0x00, 0x00, 0x00, 0x12, 0x49, 0x44, 0x41,
    0x54, 0x08, 0x99, 0x01, 0x07, 0x00, 0xF8, 0xFF,
    0xFF, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
    0x60, 0x82
  ]);
}