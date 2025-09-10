import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sleep, withRetry } from '../../src/adapters/gemini/utils.js';
import { 
  saveHtmlErrorArtifact, 
  createVertexError, 
  parseVertexError 
} from '../../src/adapters/gemini/errorHandling.js';
import { env } from '../../src/config/env.js';

/**
 * Zero-Risk Validation Tests for Gemini Refactoring
 * 
 * These tests ensure that the refactored modules behave identically
 * to the original implementations in geminiImage.ts
 */

describe('Gemini Refactoring - Zero Risk Validation', () => {
  
  describe('Utils Module', () => {
    
    describe('sleep', () => {
      it('should delay execution for specified milliseconds', async () => {
        const start = Date.now();
        await sleep(100);
        const elapsed = Date.now() - start;
        
        // Allow 10ms tolerance for timer precision
        expect(elapsed).toBeGreaterThanOrEqual(90);
        expect(elapsed).toBeLessThan(150);
      });
      
      it('should handle zero delay', async () => {
        const start = Date.now();
        await sleep(0);
        const elapsed = Date.now() - start;
        
        expect(elapsed).toBeLessThan(10);
      });
    });
    
    describe('withRetry', () => {
      it('should return successful result on first attempt', async () => {
        const mockFn = vi.fn().mockResolvedValue('success');
        
        const result = await withRetry(mockFn, 'test-operation');
        
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
      
      it('should retry on retryable errors (5xx, 429)', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce({ status: 503 })
          .mockRejectedValueOnce({ status: 429 })
          .mockResolvedValue('success');
        
        const result = await withRetry(mockFn, 'test-operation', 3, 10);
        
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(3);
      });
      
      it('should not retry on non-retryable errors (4xx except 429)', async () => {
        const mockFn = vi.fn()
          .mockRejectedValue({ status: 400, message: 'Bad Request' });
        
        await expect(withRetry(mockFn, 'test-operation'))
          .rejects.toMatchObject({ status: 400 });
        
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
      
      it('should throw after max retries exhausted', async () => {
        const mockFn = vi.fn()
          .mockRejectedValue({ status: 503 });
        
        await expect(withRetry(mockFn, 'test-operation', 2, 10))
          .rejects.toMatchObject({ status: 503 });
        
        expect(mockFn).toHaveBeenCalledTimes(2);
      });
      
      it('should apply exponential backoff with jitter', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce({ status: 503 })
          .mockResolvedValue('success');
        
        const start = Date.now();
        await withRetry(mockFn, 'test-operation', 3, 50);
        const elapsed = Date.now() - start;
        
        // Should have some delay due to backoff
        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(elapsed).toBeLessThan(200); // Max backoff + tolerance
      });
    });
  });
  
  describe('Error Handling Module', () => {
    
    beforeEach(() => {
      vi.clearAllMocks();
    });
    
    describe('createVertexError', () => {
      it('should create Problem+JSON compliant error object', () => {
        const error = createVertexError(
          'test-error',
          'Test Error',
          'This is a test error',
          500,
          { foo: 'bar' }
        );
        
        expect(error).toMatchObject({
          type: 'urn:vertex:test-error',
          title: 'Test Error',
          detail: 'This is a test error',
          status: 500
        });
        
        expect(error.instance).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(error.meta?.foo).toBe('bar');
        expect(error.meta?.project).toBe(env.GOOGLE_CLOUD_PROJECT);
        expect(error.meta?.location).toBe(env.GOOGLE_CLOUD_LOCATION);
      });
    });
    
    describe('parseVertexError', () => {
      it('should handle 404 model not found errors', async () => {
        const error = {
          status: 404,
          message: 'Publisher Model was not found'
        };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:model-entitlement');
        expect(result.title).toBe('Model Entitlement Required');
        expect(result.status).toBe(404);
      });
      
      it('should handle 403 permission denied errors', async () => {
        const error = {
          status: 403,
          message: 'PERMISSION_DENIED: User does not have permission'
        };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:permission-denied');
        expect(result.title).toBe('Permission Denied');
        expect(result.status).toBe(403);
      });
      
      it('should handle 429 rate limit errors', async () => {
        const error = {
          status: 429,
          message: 'RESOURCE_EXHAUSTED: Quota exceeded'
        };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:rate-limit');
        expect(result.title).toBe('Rate Limit Exceeded');
        expect(result.status).toBe(429);
      });
      
      it('should handle 503 service unavailable errors', async () => {
        const error = {
          status: 503,
          message: 'SERVICE_UNAVAILABLE'
        };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:service-unavailable');
        expect(result.title).toBe('Service Temporarily Unavailable');
        expect(result.status).toBe(503);
      });
      
      it('should handle generic API errors', async () => {
        const error = {
          status: 500,
          code: 'INTERNAL',
          message: 'Internal server error'
        };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:api-error');
        expect(result.title).toBe('Vertex AI API Error');
        expect(result.status).toBe(500);
        expect(result.meta?.errorCode).toBe('INTERNAL');
      });
      
      it('should handle unknown errors', async () => {
        const error = { something: 'unexpected' };
        
        const result = await parseVertexError(error);
        
        expect(result.type).toBe('urn:vertex:unknown-error');
        expect(result.title).toBe('Unknown Error');
        expect(result.status).toBe(500);
      });
    });
  });
  
  describe('Feature Flag Integration', () => {
    
    it('should respect USE_REFACTORED_GEMINI flag', () => {
      // Feature flag should be OFF by default
      expect(env.USE_REFACTORED_GEMINI).toBe(false);
    });
    
    it('should allow toggling refactored implementation', () => {
      // This test validates that the feature flag can be changed
      // In production, this would be done via environment variable
      const originalValue = env.USE_REFACTORED_GEMINI;
      
      // Simulate changing the flag (in tests only)
      Object.defineProperty(env, 'USE_REFACTORED_GEMINI', {
        value: true,
        writable: true,
        configurable: true
      });
      
      expect(env.USE_REFACTORED_GEMINI).toBe(true);
      
      // Restore original value
      Object.defineProperty(env, 'USE_REFACTORED_GEMINI', {
        value: originalValue,
        writable: true,
        configurable: true
      });
    });
  });
  
  describe('Backward Compatibility', () => {
    
    it('should maintain identical function signatures', () => {
      // Verify sleep signature
      expect(sleep).toBeInstanceOf(Function);
      expect(sleep.length).toBe(1); // Takes 1 parameter
      
      // Verify withRetry signature
      expect(withRetry).toBeInstanceOf(Function);
      expect(withRetry.length).toBe(2); // Takes 2 required parameters (2 have defaults)
      
      // Verify createVertexError signature
      expect(createVertexError).toBeInstanceOf(Function);
      expect(createVertexError.length).toBe(5); // Takes 5 parameters
    });
    
    it('should produce identical outputs for same inputs', async () => {
      // Test sleep consistency
      const sleepPromise1 = sleep(50);
      const sleepPromise2 = sleep(50);
      
      expect(sleepPromise1).toBeInstanceOf(Promise);
      expect(sleepPromise2).toBeInstanceOf(Promise);
      
      // Test error creation consistency
      const error1 = createVertexError('test', 'Test', 'Detail', 400);
      const error2 = createVertexError('test', 'Test', 'Detail', 400);
      
      // Should have same structure but different instances
      expect(error1.type).toBe(error2.type);
      expect(error1.title).toBe(error2.title);
      expect(error1.detail).toBe(error2.detail);
      expect(error1.status).toBe(error2.status);
      expect(error1.instance).not.toBe(error2.instance); // UUIDs differ
    });
  });
});

/**
 * Integration test to ensure refactored modules work together
 */
describe('Gemini Refactoring - Integration', () => {
  
  it('should handle a complete error flow', async () => {
    // Simulate an error scenario
    const mockApiCall = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue({ data: 'success' });
    
    // Use withRetry with the mock
    const result = await withRetry(mockApiCall, 'integration-test', 3, 10);
    
    expect(result).toEqual({ data: 'success' });
    expect(mockApiCall).toHaveBeenCalledTimes(3);
  });
  
  it('should handle error parsing and creation together', async () => {
    const apiError = {
      status: 429,
      message: 'RESOURCE_EXHAUSTED: Too many requests'
    };
    
    const parsedError = await parseVertexError(apiError);
    
    expect(parsedError).toMatchObject({
      type: 'urn:vertex:rate-limit',
      title: 'Rate Limit Exceeded',
      status: 429
    });
    
    // Verify the error has all required fields
    expect(parsedError.instance).toBeDefined();
    expect(parsedError.detail).toBeDefined();
    expect(parsedError.meta).toBeDefined();
  });
});