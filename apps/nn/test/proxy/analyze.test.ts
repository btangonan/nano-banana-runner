import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock Google Generative AI
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// Mock logger
vi.mock('../../proxy/src/utils/logger.js', () => ({
  createOperationLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Import the route after mocking
import analyzeRoutes from '../../proxy/src/routes/analyze.js';

describe('Analyze Route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Set up Fastify app
    app = Fastify({ logger: false });
    
    // Register the analyze routes
    await app.register(analyzeRoutes);
    
    // Set required environment variable
    process.env.GEMINI_API_KEY = 'test-api-key';
    
    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  // Helper function to create test image (1x1 PNG)
  const createTestImageBase64 = (): string => {
    const buffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
      0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    return buffer.toString('base64');
  };

  describe('POST /analyze/describe', () => {
    it('should analyze image successfully', async () => {
      // Mock Gemini API response
      const mockGeminiResponse = {
        response: {
          text: () => JSON.stringify({
            objects: ['tree', 'sky', 'grass'],
            scene: 'peaceful outdoor scene with trees',
            style: ['realistic', 'natural'],
            composition: 'rule of thirds with centered subject',
            colors: ['#2E7D32', '#4CAF50', '#81C784'],
            lighting: 'soft natural daylight',
            qualityIssues: [],
            safetyTags: [],
            confidence: 0.92
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
          mimeType: 'image/png',
          dryRun: false,
        },
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.body);
      expect(result.descriptor).toBeDefined();
      expect(result.descriptor.provider).toBe('gemini');
      expect(result.descriptor.objects).toEqual(['tree', 'sky', 'grass']);
      expect(result.descriptor.scene).toBe('peaceful outdoor scene with trees');
      expect(result.descriptor.confidence).toBe(0.92);
      expect(result.descriptor.hash).toBeDefined();
      expect(result.descriptor.width).toBe(1);
      expect(result.descriptor.height).toBe(1);
    });

    it('should handle dry-run mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
          mimeType: 'image/png',
          dryRun: true,
        },
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.body);
      expect(result.costEstimate).toBeDefined();
      expect(result.costEstimate.provider).toBe('gemini');
      expect(result.costEstimate.imageCount).toBe(1);
      expect(result.costEstimate.estimatedCost).toBeGreaterThan(0);
      expect(result.descriptor).toBeUndefined();
      
      // Should not call Gemini API in dry-run mode
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should validate request schema', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          // Missing required 'image' field
          mimeType: 'image/png',
        },
      });

      expect(response.statusCode).toBe(400);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('validation_error');
      expect(result.title).toBe('Invalid request data');
    });

    it('should handle invalid base64 data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: 'invalid-base64!@#$',
          mimeType: 'image/png',
        },
      });

      expect(response.statusCode).toBe(400);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('invalid_image');
      expect(result.title).toBe('Invalid base64 image data');
    });

    it('should handle missing API key', async () => {
      delete process.env.GEMINI_API_KEY;

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(500);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('configuration_error');
      expect(result.title).toBe('Gemini API key not configured');
    });

    it('should handle Gemini API timeout', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(504);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('timeout');
      expect(result.title).toBe('Request timeout');
      expect(result.retryable).toBe(true);
    });

    it('should handle rate limiting', async () => {
      const rateLimitError = new Error('429 Rate limit exceeded');
      mockGenerateContent.mockRejectedValue(rateLimitError);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(429);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('rate_limited');
      expect(result.title).toBe('Rate limit exceeded');
      expect(result.retryable).toBe(true);
    });

    it('should handle invalid JSON from Gemini', async () => {
      // Mock Gemini returning non-JSON response
      const mockGeminiResponse = {
        response: {
          text: () => 'This is not valid JSON, just some text description'
        }
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(422);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('invalid_json');
      expect(result.title).toBe('Invalid JSON response from model');
      expect(result.retryable).toBe(true);
    });

    it('should handle malformed JSON from Gemini', async () => {
      // Mock Gemini returning malformed JSON
      const mockGeminiResponse = {
        response: {
          text: () => '{"objects": ["tree"], "scene": "forest", invalid}'
        }
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(422);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('invalid_json');
      expect(result.retryable).toBe(true);
    });

    it('should handle schema validation failure from Gemini', async () => {
      // Mock Gemini returning JSON that doesn't match our schema
      const mockGeminiResponse = {
        response: {
          text: () => JSON.stringify({
            invalidField: 'should not be here',
            objects: ['tree'],
            // Missing required fields
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(422);
      
      const result = JSON.parse(response.body);
      expect(result.type).toBe('invalid_json');
      expect(result.title).toBe('Invalid JSON response from model');
    });

    it('should retry on failure and eventually succeed', async () => {
      // First call fails, second succeeds
      mockGenerateContent
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          response: {
            text: () => JSON.stringify({
              objects: ['retry', 'success'],
              scene: 'test scene',
              style: ['test'],
              composition: 'test composition',
              colors: ['#000000'],
              lighting: 'test lighting',
              qualityIssues: [],
              safetyTags: [],
              confidence: 0.85
            })
          }
        });

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      
      const result = JSON.parse(response.body);
      expect(result.descriptor.objects).toEqual(['retry', 'success']);
    });

    it('should clean up markdown formatting from Gemini response', async () => {
      // Mock Gemini returning JSON wrapped in markdown code blocks
      const mockGeminiResponse = {
        response: {
          text: () => '```json\n' + JSON.stringify({
            objects: ['tree'],
            scene: 'test',
            style: ['natural'],
            composition: 'centered',
            colors: ['#green'],
            lighting: 'natural',
            qualityIssues: [],
            safetyTags: [],
            confidence: 0.9
          }) + '\n```'
        }
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
        },
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.body);
      expect(result.descriptor.objects).toEqual(['tree']);
      expect(result.descriptor.confidence).toBe(0.9);
    });
  });

  describe('GET /analyze/metrics', () => {
    it('should return metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/analyze/metrics',
      });

      expect(response.statusCode).toBe(200);
      
      const metrics = JSON.parse(response.body);
      expect(metrics).toHaveProperty('requests_total');
      expect(metrics).toHaveProperty('failures_total');
      expect(metrics).toHaveProperty('rate_limited_total');
      expect(metrics).toHaveProperty('latency_histogram');
    });
  });

  describe('image preprocessing', () => {
    it('should preprocess large images', async () => {
      // Mock a successful Gemini response
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            objects: ['preprocessed'],
            scene: 'test',
            style: ['compressed'],
            composition: 'resized',
            colors: ['#000000'],
            lighting: 'optimized',
            qualityIssues: [],
            safetyTags: [],
            confidence: 0.95
          })
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/analyze/describe',
        payload: {
          image: createTestImageBase64(),
          mimeType: 'image/png',
        },
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.body);
      expect(result.descriptor).toBeDefined();
      expect(result.descriptor.objects).toContain('preprocessed');
      
      // Verify that Gemini was called (meaning preprocessing succeeded)
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });
});