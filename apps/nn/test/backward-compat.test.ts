import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyzeImage, analyzeImages, isSupportedImage, resetProvider, getCurrentProviderName } from '../src/core/analyze.js';
import type { ImageDescriptor } from '../src/types.js';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Backward Compatibility Tests for PR-3
 * 
 * These tests ensure that the integration of the provider system
 * maintains 100% backward compatibility with existing code.
 */
describe('Backward Compatibility - PR-3 Integration', () => {
  const testDir = join(tmpdir(), 'nn-backward-compat-test');
  const testImage1 = join(testDir, 'test1.png');
  const testImage2 = join(testDir, 'test2.jpg');
  const testImage3 = join(testDir, 'test3.webp');
  const unsupportedFile = join(testDir, 'test.txt');
  
  // Create minimal test PNG buffer
  const createTestPNG = (): Buffer => Buffer.from([
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
  
  // Create minimal JPEG buffer (just header)
  const createTestJPEG = (): Buffer => Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
  ]);
  
  beforeEach(async () => {
    // Reset provider cache for clean tests
    resetProvider();
    
    // Create test directory and files
    await rm(testDir, { recursive: true, force: true });
    await writeFile(testImage1, createTestPNG());
    await writeFile(testImage2, createTestJPEG());
    await writeFile(testImage3, createTestPNG()); // Pretend it's WebP
    await writeFile(unsupportedFile, Buffer.from('not an image'));
  });
  
  afterEach(async () => {
    // Clean up test files
    await rm(testDir, { recursive: true, force: true });
    
    // Reset environment to defaults
    delete process.env.NN_ANALYZE_PROVIDER;
    delete process.env.NN_ANALYZE_KILL_SWITCH;
    delete process.env.NN_ANALYZE_CACHE_ENABLED;
    delete process.env.NN_ANALYZE_ROLLOUT_PERCENT;
    
    // Reset provider cache
    resetProvider();
  });
  
  describe('Function Signatures', () => {
    it('should export all required functions', () => {
      expect(typeof analyzeImage).toBe('function');
      expect(typeof analyzeImages).toBe('function');
      expect(typeof isSupportedImage).toBe('function');
      expect(typeof resetProvider).toBe('function');
      expect(typeof getCurrentProviderName).toBe('function');
    });
    
    it('should maintain analyzeImage signature', () => {
      // analyzeImage should accept a single string path
      expect(analyzeImage.length).toBe(1); // Function arity
    });
    
    it('should maintain analyzeImages signature', () => {
      // analyzeImages should accept paths array and optional concurrency
      expect(analyzeImages.length).toBe(2); // Function arity
    });
  });
  
  describe('Default Behavior (Sharp Provider)', () => {
    it('should use Sharp provider by default', () => {
      const providerName = getCurrentProviderName();
      expect(providerName).toBe('sharp');
    });
    
    it('should analyze single image with Sharp by default', async () => {
      const result = await analyzeImage(testImage1);
      
      expect(result).toBeDefined();
      expect(result.path).toBe(testImage1);
      expect(result.width).toBe(2); // Our test PNG is 2x2
      expect(result.height).toBe(2);
      expect(result.hash).toBeDefined();
      expect(result.palette).toBeInstanceOf(Array);
      expect(result.subjects).toBeInstanceOf(Array);
      expect(result.style).toBeInstanceOf(Array);
      expect(result.errors).toBeUndefined();
    });
    
    it('should batch analyze images with Sharp by default', async () => {
      const results = await analyzeImages([testImage1, testImage2]);
      
      expect(results).toHaveLength(2);
      expect(results[0]?.path).toBe(testImage1);
      expect(results[1]?.path).toBe(testImage2);
      
      results.forEach(result => {
        expect(result.hash).toBeDefined();
        expect(result.errors).toBeUndefined();
      });
    });
  });
  
  describe('Image Format Support', () => {
    it('should support standard image formats', () => {
      expect(isSupportedImage('test.jpg')).toBe(true);
      expect(isSupportedImage('test.jpeg')).toBe(true);
      expect(isSupportedImage('test.png')).toBe(true);
      expect(isSupportedImage('test.webp')).toBe(true);
      expect(isSupportedImage('test.JPG')).toBe(true); // Case insensitive
    });
    
    it('should reject unsupported formats', () => {
      expect(isSupportedImage('test.txt')).toBe(false);
      expect(isSupportedImage('test.pdf')).toBe(false);
      expect(isSupportedImage('test.gif')).toBe(false);
      expect(isSupportedImage('test')).toBe(false);
    });
    
    it('should handle unsupported format gracefully', async () => {
      const result = await analyzeImage(unsupportedFile);
      
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Unsupported image format');
      expect(result.width).toBe(1); // Fallback values
      expect(result.height).toBe(1);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle missing files gracefully', async () => {
      const missingFile = join(testDir, 'missing.png');
      const result = await analyzeImage(missingFile);
      
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toBeDefined();
      expect(result.path).toBe(missingFile);
      expect(result.width).toBe(1); // Fallback values
      expect(result.height).toBe(1);
    });
    
    it('should handle batch analysis with mixed valid/invalid files', async () => {
      const results = await analyzeImages([
        testImage1,
        unsupportedFile,
        testImage2,
      ]);
      
      // Should only analyze supported formats
      expect(results).toHaveLength(2);
      expect(results[0]?.path).toBe(testImage1);
      expect(results[1]?.path).toBe(testImage2);
    });
  });
  
  describe('Return Type Compatibility', () => {
    it('should return ImageDescriptor with all required fields', async () => {
      const result = await analyzeImage(testImage1);
      
      // Required fields from original implementation
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result).toHaveProperty('palette');
      expect(result).toHaveProperty('subjects');
      expect(result).toHaveProperty('style');
      expect(result).toHaveProperty('lighting');
      
      // Optional fields
      if (!result.errors) {
        expect(typeof result.hash).toBe('string');
        expect(result.hash.length).toBeGreaterThan(0);
      }
    });
    
    it('should maintain type compatibility for batch results', async () => {
      const results = await analyzeImages([testImage1, testImage2]);
      
      expect(Array.isArray(results)).toBe(true);
      
      results.forEach(result => {
        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('hash');
        expect(result).toHaveProperty('width');
        expect(result).toHaveProperty('height');
        expect(result).toHaveProperty('palette');
      });
    });
  });
  
  describe('Provider Selection', () => {
    it('should respect NN_ANALYZE_PROVIDER environment variable', () => {
      // Set to Sharp explicitly
      process.env.NN_ANALYZE_PROVIDER = 'sharp';
      resetProvider();
      
      expect(getCurrentProviderName()).toBe('sharp');
      
      // Note: We can't test Gemini without mocking the proxy
      // But we verify the configuration is respected
    });
    
    it('should respect kill-switch to force Sharp', () => {
      process.env.NN_ANALYZE_PROVIDER = 'gemini';
      process.env.NN_ANALYZE_KILL_SWITCH = 'true';
      resetProvider();
      
      // Kill-switch should force Sharp even when Gemini is requested
      expect(getCurrentProviderName()).toBe('sharp');
    });
    
    it('should handle invalid provider gracefully', () => {
      process.env.NN_ANALYZE_PROVIDER = 'invalid';
      resetProvider();
      
      // Should fallback to Sharp
      expect(getCurrentProviderName()).toBe('sharp');
    });
  });
  
  describe('Concurrency Control', () => {
    it('should respect concurrency parameter in batch analysis', async () => {
      const paths = [testImage1, testImage2, testImage3];
      
      // Test with different concurrency values
      const results1 = await analyzeImages(paths, 1);
      const results2 = await analyzeImages(paths, 3);
      
      // Both should produce same number of results
      expect(results1).toHaveLength(3);
      expect(results2).toHaveLength(3);
      
      // Results should be valid regardless of concurrency
      [...results1, ...results2].forEach(result => {
        expect(result.path).toBeDefined();
        expect(result.hash).toBeDefined();
      });
    });
    
    it('should use default concurrency when not specified', async () => {
      const results = await analyzeImages([testImage1, testImage2]);
      
      expect(results).toHaveLength(2);
      expect(results[0]?.errors).toBeUndefined();
      expect(results[1]?.errors).toBeUndefined();
    });
  });
  
  describe('Cache Behavior', () => {
    it('should cache provider instance across calls', async () => {
      // First call creates provider
      const name1 = getCurrentProviderName();
      
      // Second call should reuse cached provider
      const name2 = getCurrentProviderName();
      
      expect(name1).toBe(name2);
      expect(name1).toBe('sharp'); // Default
    });
    
    it('should reset provider cache when resetProvider is called', () => {
      const name1 = getCurrentProviderName();
      
      resetProvider();
      
      // After reset, new provider should be created
      const name2 = getCurrentProviderName();
      
      expect(name1).toBe(name2); // Both should be 'sharp'
    });
  });
  
  describe('Performance Characteristics', () => {
    it('should complete single image analysis quickly with Sharp', async () => {
      const startTime = Date.now();
      await analyzeImage(testImage1);
      const duration = Date.now() - startTime;
      
      // Sharp should be fast for small test images
      expect(duration).toBeLessThan(1000); // Less than 1 second
    });
    
    it('should handle batch analysis efficiently', async () => {
      const startTime = Date.now();
      await analyzeImages([testImage1, testImage2, testImage3]);
      const duration = Date.now() - startTime;
      
      // Batch of 3 small images should be fast
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
    });
  });
  
  describe('Backward Compatibility Guarantees', () => {
    it('should not break existing code using analyzeImage', async () => {
      // Simulate existing code pattern
      const doAnalysis = async (imagePath: string) => {
        const descriptor = await analyzeImage(imagePath);
        return {
          isValid: !descriptor.errors,
          dimensions: `${descriptor.width}x${descriptor.height}`,
          hasColors: descriptor.palette && descriptor.palette.length > 0,
        };
      };
      
      const result = await doAnalysis(testImage1);
      
      expect(result.isValid).toBe(true);
      expect(result.dimensions).toBe('2x2');
      expect(result.hasColors).toBe(true);
    });
    
    it('should not break existing code using analyzeImages', async () => {
      // Simulate existing batch processing code
      const processBatch = async (paths: string[]) => {
        const results = await analyzeImages(paths, 2);
        return results.map(r => ({
          file: r.path.split('/').pop(),
          success: !r.errors,
          hash: r.hash,
        }));
      };
      
      const batch = await processBatch([testImage1, testImage2]);
      
      expect(batch).toHaveLength(2);
      expect(batch[0]?.success).toBe(true);
      expect(batch[1]?.success).toBe(true);
      expect(batch[0]?.hash).toBeDefined();
      expect(batch[1]?.hash).toBeDefined();
    });
    
    it('should maintain error handling behavior', async () => {
      // Simulate existing error handling
      const safeAnalyze = async (path: string): Promise<ImageDescriptor | null> => {
        try {
          const result = await analyzeImage(path);
          if (result.errors) {
            console.log('Analysis failed:', result.errors);
            return null;
          }
          return result;
        } catch (error) {
          console.log('Unexpected error:', error);
          return null;
        }
      };
      
      // Should handle missing file
      const result1 = await safeAnalyze(join(testDir, 'missing.png'));
      expect(result1).toBeNull();
      
      // Should handle valid file
      const result2 = await safeAnalyze(testImage1);
      expect(result2).not.toBeNull();
      expect(result2?.path).toBe(testImage1);
    });
  });
});