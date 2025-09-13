import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GeminiProvider } from '../../src/core/providers/gemini.js';
import type { ImageDescriptor } from '../../src/core/providers/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider({
      proxyUrl: 'http://test:8787',
      timeoutMs: 5000,
      retries: 2,
    });
    
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configuration', () => {
    it('should have correct name and default config', () => {
      expect(provider.name).toBe('gemini');
      expect(provider.config.maxImagesPerBatch).toBe(64);
      expect(provider.config.costPerImage).toBe(0.0025);
      expect(provider.config.chunkSize).toBe(16);
    });

    it('should accept custom configuration', () => {
      const customProvider = new GeminiProvider({
        maxImagesPerBatch: 32,
        chunkSize: 8,
        proxyUrl: 'http://custom:9999',
      });
      
      expect(customProvider.config.maxImagesPerBatch).toBe(32);
      expect(customProvider.config.chunkSize).toBe(8);
      expect(customProvider.config.proxyUrl).toBe('http://custom:9999');
    });
  });

  describe('MIME type detection', () => {
    // Create test image buffers
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const webpBuffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP')
    ]);

    it('should detect PNG MIME type', () => {
      // Access private method for testing
      const mimeType = (provider as any).detectMimeType(pngBuffer);
      expect(mimeType).toBe('image/png');
    });

    it('should detect JPEG MIME type', () => {
      const mimeType = (provider as any).detectMimeType(jpegBuffer);
      expect(mimeType).toBe('image/jpeg');
    });

    it('should detect WebP MIME type', () => {
      const mimeType = (provider as any).detectMimeType(webpBuffer);
      expect(mimeType).toBe('image/webp');
    });

    it('should default to JPEG for unknown formats', () => {
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const mimeType = (provider as any).detectMimeType(unknownBuffer);
      expect(mimeType).toBe('image/jpeg');
    });
  });

  describe('analyze', () => {
    const testBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // Minimal PNG

    it('should analyze image successfully', async () => {
      const mockResponse = {
        descriptor: {
          provider: 'gemini',
          objects: ['tree', 'sky'],
          scene: 'outdoor landscape',
          style: ['realistic', 'natural'],
          composition: 'centered subject with rule of thirds',
          colors: ['#2E7D32', '#1976D2'],
          lighting: 'soft natural light',
          confidence: 0.92,
          width: 1024,
          height: 768,
          format: 'jpeg',
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.analyze('test.png', testBuffer);

      expect(result.provider).toBe('gemini');
      expect(result.path).toBe('test.png');
      expect(result.objects).toEqual(['tree', 'sky']);
      expect(result.scene).toBe('outdoor landscape');
      expect(result.confidence).toBe(0.92);
      expect(result.hash).toBeDefined();
      expect(result.errors).toBeUndefined();

      // Verify fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:8787/analyze/describe',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle proxy errors gracefully', async () => {
      const mockErrorResponse = {
        error: {
          type: 'rate_limited',
          title: 'Rate limit exceeded',
          status: 429,
          retryable: true,
          costIncurred: 0,
        }
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => mockErrorResponse,
      });

      const result = await provider.analyze('test.png', testBuffer);

      expect(result.provider).toBe('gemini');
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Rate limit exceeded');
    });

    it('should handle network timeouts', async () => {
      mockFetch.mockRejectedValue(new Error('Request timeout'));

      const result = await provider.analyze('test.png', testBuffer);

      expect(result.provider).toBe('gemini');
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Request timeout');
    });

    it('should retry on retryable errors', async () => {
      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            descriptor: {
              provider: 'gemini',
              objects: ['test'],
              confidence: 0.8,
              width: 100,
              height: 100,
            }
          }),
        });

      const result = await provider.analyze('test.png', testBuffer);

      expect(result.provider).toBe('gemini');
      expect(result.errors).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('analyzeBatch', () => {
    const testItems = [
      { path: 'test1.png', buffer: Buffer.from('image1') },
      { path: 'test2.png', buffer: Buffer.from('image2') },
      { path: 'test3.png', buffer: Buffer.from('image3') },
    ];

    it('should process batch in chunks', async () => {
      // Mock successful responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          descriptor: {
            provider: 'gemini',
            objects: ['test'],
            confidence: 0.8,
            width: 100,
            height: 100,
          }
        }),
      });

      const results = await provider.analyzeBatch(testItems);

      expect(results).toHaveLength(3);
      expect(results[0]?.path).toBe('test1.png');
      expect(results[1]?.path).toBe('test2.png');
      expect(results[2]?.path).toBe('test3.png');

      // Should make 3 separate API calls (one per image)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should respect batch size limits', async () => {
      const smallProvider = new GeminiProvider({ maxImagesPerBatch: 2 });
      
      await expect(smallProvider.analyzeBatch(testItems))
        .rejects.toThrow('Batch size 3 exceeds limit 2');
    });

    it('should handle mixed success and failure', async () => {
      // First call succeeds, second fails, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            descriptor: { provider: 'gemini', objects: ['success'], confidence: 0.8 }
          }),
        })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            descriptor: { provider: 'gemini', objects: ['success2'], confidence: 0.8 }
          }),
        });

      const results = await provider.analyzeBatch(testItems);

      expect(results).toHaveLength(3);
      expect(results[0]?.errors).toBeUndefined();
      expect(results[1]?.errors).toBeDefined();
      expect(results[2]?.errors).toBeUndefined();
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost correctly', async () => {
      const estimate = await provider.estimateCost(10);

      expect(estimate.imageCount).toBe(10);
      expect(estimate.estimatedCost).toBe(0.025); // 10 * 0.0025
      expect(estimate.provider).toBe('gemini');
      expect(estimate.estimatedTimeMs).toBe(20000); // 10 * 2000ms
    });
  });

  describe('validateConfig', () => {
    it('should validate configuration with dry-run test', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          costEstimate: {
            imageCount: 1,
            estimatedCost: 0.0025,
            provider: 'gemini',
          }
        }),
      });

      const isValid = await provider.validateConfig();
      expect(isValid).toBe(true);

      // Should call proxy with dryRun=true
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.dryRun).toBe(true);
    });

    it('should return false on validation failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      const isValid = await provider.validateConfig();
      expect(isValid).toBe(false);
    });
  });

  describe('metrics', () => {
    it('should track request metrics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          descriptor: { provider: 'gemini', objects: [], confidence: 0.8 }
        }),
      });

      // Reset metrics
      provider.resetMetrics();
      const initialMetrics = provider.getMetrics();
      expect(initialMetrics.requestsTotal).toBe(0);

      // Make some requests
      const testBuffer = Buffer.from('test');
      await provider.analyze('test1.png', testBuffer);
      await provider.analyze('test2.png', testBuffer);

      const metricsAfter = provider.getMetrics();
      expect(metricsAfter.requestsTotal).toBe(2);
      expect(metricsAfter.latencyHistogram).toHaveLength(2);
      expect(metricsAfter.failuresTotal).toBe(0);
      expect(metricsAfter.costTotal).toBe(0.005); // 2 * 0.0025
    });

    it('should track failure metrics', async () => {
      mockFetch.mockRejectedValue(new Error('API failed'));

      provider.resetMetrics();
      await provider.analyze('test.png', Buffer.from('test'));

      const metrics = provider.getMetrics();
      expect(metrics.requestsTotal).toBe(1);
      expect(metrics.failuresTotal).toBe(1);
    });

    it('should provide cost breakdown', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          descriptor: { provider: 'gemini', objects: [], confidence: 0.8 }
        }),
      });

      provider.resetMetrics();
      await provider.analyze('test.png', Buffer.from('test'));

      const breakdown = provider.getCostBreakdown();
      expect(breakdown.totalCost).toBe(0.0025);
      expect(breakdown.avgCostPerImage).toBe(0.0025);
      expect(breakdown.totalImages).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should cleanup without errors', async () => {
      await expect(provider.cleanup()).resolves.toBeUndefined();
    });
  });
});