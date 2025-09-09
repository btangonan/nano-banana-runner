import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiImageAdapter } from '../../src/adapters/geminiImage';
import { VertexAI } from '@google-cloud/vertexai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock modules
vi.mock('@google-cloud/vertexai');
vi.mock('node:fs/promises');
vi.mock('../../src/config/env', () => ({
  env: {
    GOOGLE_CLOUD_PROJECT: 'test-project',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
    NN_OUT_DIR: './artifacts',
    NN_MAX_CONCURRENCY: '2',
    NN_PRICE_PER_IMAGE_USD: '0.0025'
  }
}));

describe('GeminiImageAdapter Error Handling', () => {
  let adapter: GeminiImageAdapter;
  let mockGenerateContent: ReturnType<typeof vi.fn>;
  let mockModel: any;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Setup mock model
    mockGenerateContent = vi.fn();
    mockModel = {
      generateContent: mockGenerateContent
    };

    // Mock VertexAI
    const MockVertexAI = VertexAI as unknown as ReturnType<typeof vi.fn>;
    MockVertexAI.prototype.getGenerativeModel = vi.fn().mockReturnValue(mockModel);

    // Mock fs operations
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-image-data'));

    // Create adapter instance
    adapter = new GeminiImageAdapter({
      project: 'test-project',
      location: 'us-central1'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('404 Model Not Found Errors', () => {
    it('should handle 404 model entitlement error correctly', async () => {
      const error = new Error('Publisher Model `projects/test-project/locations/us-central1/publishers/google/models/gemini-1.5-flash` was not found');
      (error as any).status = 404;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:model-entitlement',
        title: 'Model Entitlement Required',
        status: 404,
        meta: {
          project: 'test-project',
          location: 'us-central1',
          model: 'gemini-1.5-flash',
          action: 'Request entitlement from Google Cloud support'
        }
      });
    });

    it('should handle generic 404 error correctly', async () => {
      const error = new Error('NOT_FOUND: Resource not available');
      (error as any).status = 404;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:model-not-found',
        title: 'Model Not Found',
        status: 404,
        meta: {
          project: 'test-project',
          location: 'us-central1'
        }
      });
    });
  });

  describe('HTML Error Response Handling', () => {
    it('should detect and save HTML error responses', async () => {
      const htmlResponse = '<!DOCTYPE html><html><body>Service Error</body></html>';
      const error = new Error('Request failed');
      (error as any).response = htmlResponse;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:html-error-response',
        title: 'Non-JSON Error Response',
        status: 503,
        meta: expect.objectContaining({
          firstBytes: htmlResponse.slice(0, 100)
        })
      });

      // Verify HTML artifact was saved
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('artifacts/errors'),
        { recursive: true }
      );
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/vertex_html_error_.*\.html$/),
        htmlResponse.slice(0, 512),
        'utf-8'
      );
    });

    it('should handle HTML response starting with <html tag', async () => {
      const htmlResponse = '<html><head><title>Error</title></head><body>Error page</body></html>';
      const error = new Error('Request failed');
      (error as any).response = htmlResponse;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:html-error-response',
        title: 'Non-JSON Error Response',
        status: 503
      });
    });
  });

  describe('Permission and Rate Limit Errors', () => {
    it('should handle 403 permission denied error', async () => {
      const error = new Error('PERMISSION_DENIED: Insufficient permissions');
      (error as any).status = 403;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:permission-denied',
        title: 'Permission Denied',
        status: 403,
        meta: {
          requiredRole: 'roles/aiplatform.user'
        }
      });
    });

    it('should handle 429 rate limit error', async () => {
      const error = new Error('RESOURCE_EXHAUSTED: Quota exceeded');
      (error as any).status = 429;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:rate-limit',
        title: 'Rate Limit Exceeded',
        status: 429,
        meta: {
          suggestion: 'Reduce NN_MAX_CONCURRENCY to 1 or 2'
        }
      });
    });
  });

  describe('Service Unavailable Errors', () => {
    it('should handle 503 service unavailable error', async () => {
      const error = new Error('SERVICE_UNAVAILABLE');
      (error as any).status = 503;
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:service-unavailable',
        title: 'Service Temporarily Unavailable',
        status: 503
      });
    });
  });

  describe('Generic API Errors', () => {
    it('should handle generic API errors with status code', async () => {
      const error = new Error('Internal server error');
      (error as any).status = 500;
      (error as any).code = 'INTERNAL';
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:api-error',
        title: 'Vertex AI API Error',
        status: 500,
        meta: {
          errorCode: 'INTERNAL',
          originalError: 'Internal server error'
        }
      });
    });

    it('should handle unknown errors without modification', async () => {
      const error = new Error('Unknown error');
      
      mockGenerateContent.mockRejectedValue(error);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toThrow('Unknown error');
    });
  });

  describe('Dry Run Mode', () => {
    it('should return cost estimation without making API calls', async () => {
      const request = {
        rows: [
          { prompt: 'prompt 1' },
          { prompt: 'prompt 2' }
        ],
        variants: 2,
        styleRefs: ['./test-style.png'],
        runMode: 'dry_run' as const
      };

      const result = await adapter.render(request);

      expect(result).toMatchObject({
        results: [],
        costPlan: {
          imageCount: 4, // 2 rows * 2 variants
          estimatedCost: 0.01, // 4 * 0.0025
          estimatedTime: expect.stringMatching(/\d+s/)
        }
      });

      // Verify no API calls were made
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry on retryable errors (5xx)', async () => {
      const error500 = new Error('Server error');
      (error500 as any).status = 500;
      
      // First call fails, second succeeds
      mockGenerateContent
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce({
          response: {
            candidates: [{
              content: {
                parts: [{
                  inlineData: {
                    mimeType: 'image/png',
                    data: Buffer.from('fake-image').toString('base64')
                  }
                }]
              }
            }]
          }
        });

      // Mock other required functions
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      // Should eventually succeed after retry
      const result = await adapter.render(request);
      
      expect(result.results).toHaveLength(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors (4xx except 429)', async () => {
      const error400 = new Error('Bad request');
      (error400 as any).status = 400;
      
      mockGenerateContent.mockRejectedValue(error400);

      const request = {
        rows: [{ prompt: 'test prompt' }],
        variants: 1,
        styleRefs: ['./test-style.png'],
        runMode: 'live' as const
      };

      await expect(adapter.render(request)).rejects.toMatchObject({
        type: 'urn:vertex:api-error',
        status: 400
      });
      
      // Should only call once (no retry)
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});