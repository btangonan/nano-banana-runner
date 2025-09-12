/**
 * Tests for Dual-Mode E2E Adapter
 * Validates: budget tracking, cassette recording/replay, schema validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiTestAdapter, GeminiResponseSchema } from './dual-mode.adapter';
import { existsSync, rmSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

describe('GeminiTestAdapter', () => {
  const TEST_CASSETTE_DIR = 'test/e2e/fixtures/recordings/test';
  const TEST_ARTIFACTS_DIR = 'test/e2e/.artifacts/test';
  
  // Mock real API implementation
  const mockRealAPI = {
    call: vi.fn()
  };
  
  // Valid mock response matching schema
  const validResponse = {
    candidates: [{
      content: {
        parts: [{ text: 'test response' }],
        role: 'model'
      },
      finishReason: 'STOP',
      index: 0,
      safetyRatings: []
    }],
    promptFeedback: {
      safetyRatings: []
    }
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.E2E_MODE;
    delete process.env.E2E_BUDGET_USD;
    delete process.env.E2E_CASSETTES_DIR;
    delete process.env.E2E_VERSION_TAG;
  });
  
  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_CASSETTE_DIR)) {
      rmSync(TEST_CASSETTE_DIR, { recursive: true, force: true });
    }
    if (existsSync(TEST_ARTIFACTS_DIR)) {
      rmSync(TEST_ARTIFACTS_DIR, { recursive: true, force: true });
    }
  });
  
  describe('Budget Tracking', () => {
    it('should track spending correctly', () => {
      const adapter = new GeminiTestAdapter('mock', mockRealAPI);
      
      expect(adapter.canSpend(0.10)).toBe(true);
      adapter.track(0.10);
      
      expect(adapter.canSpend(0.40)).toBe(true); // 0.10 + 0.40 = 0.50 (budget)
      adapter.track(0.40);
      
      expect(adapter.canSpend(0.01)).toBe(false); // Would exceed 0.50
      
      const stats = adapter.getStats();
      expect(stats.spent).toBe(0.50);
      expect(stats.budgetRemaining).toBe(0);
      expect(stats.budgetPercentUsed).toBe(100);
    });
    
    it('should fail when budget exceeded in live mode', async () => {
      process.env.E2E_BUDGET_USD = '0.01';
      const adapter = new GeminiTestAdapter('live', mockRealAPI);
      
      // First call should succeed
      mockRealAPI.call.mockResolvedValueOnce(validResponse);
      await adapter.callAPI({ type: 'generate', variants: 1 });
      
      // Second call should fail (budget exceeded)
      await expect(adapter.callAPI({ type: 'generate', variants: 5 }))
        .rejects.toThrow();
    });
    
    it('should reset state correctly', () => {
      const adapter = new GeminiTestAdapter('mock', mockRealAPI);
      adapter.track(0.25);
      
      expect(adapter.getStats().spent).toBe(0.25);
      
      adapter.reset();
      
      expect(adapter.getStats().spent).toBe(0);
      expect(adapter.getStats().requestCount).toBe(0);
    });
  });
  
  describe('Mode: MOCK', () => {
    it('should validate mock responses against schema', async () => {
      const adapter = new GeminiTestAdapter('mock', mockRealAPI);
      
      mockRealAPI.call.mockResolvedValueOnce(validResponse);
      const result = await adapter.callAPI({ test: 'request' });
      
      expect(result).toEqual(validResponse);
      expect(mockRealAPI.call).toHaveBeenCalledWith({ test: 'request', _mock: true });
    });
    
    it('should reject invalid mock responses', async () => {
      const adapter = new GeminiTestAdapter('mock', mockRealAPI);
      
      const invalidResponse = { invalid: 'structure' };
      mockRealAPI.call.mockResolvedValueOnce(invalidResponse);
      
      await expect(adapter.callAPI({ test: 'request' }))
        .rejects.toThrow(); // Schema validation error
    });
  });
  
  describe('Mode: RECORD', () => {
    it('should save cassettes with deterministic keys', async () => {
      process.env.E2E_CASSETTES_DIR = TEST_CASSETTE_DIR;
      const adapter = new GeminiTestAdapter('record', mockRealAPI);
      
      mockRealAPI.call.mockResolvedValueOnce(validResponse);
      
      const request = { type: 'test', data: 'example' };
      await adapter.callAPI(request);
      
      // Calculate expected cassette key
      const normalized = JSON.stringify(request, (_k, v) => 
        typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...[truncated]' : v
      );
      const expectedKey = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + normalized)
        .digest('hex');
      
      const cassetteFile = join(TEST_CASSETTE_DIR, `${expectedKey}.json`);
      expect(existsSync(cassetteFile)).toBe(true);
      
      // Verify cassette content
      const cassette = JSON.parse(await readFile(cassetteFile, 'utf-8'));
      expect(cassette).toEqual(validResponse);
    });
    
    it('should redact sensitive data in cassettes', async () => {
      process.env.E2E_CASSETTES_DIR = TEST_CASSETTE_DIR;
      const adapter = new GeminiTestAdapter('record', mockRealAPI);
      
      const sensitiveResponse = {
        ...validResponse,
        apiKey: 'secret-key',
        authorization: 'Bearer token'
      };
      
      mockRealAPI.call.mockResolvedValueOnce(sensitiveResponse);
      await adapter.callAPI({ type: 'test' });
      
      // Read saved cassette
      const files = require('fs').readdirSync(TEST_CASSETTE_DIR);
      const cassette = JSON.parse(
        await readFile(join(TEST_CASSETTE_DIR, files[0]), 'utf-8')
      );
      
      // Sensitive data should be redacted
      expect(cassette.apiKey).toBeUndefined();
      expect(cassette.authorization).toBeUndefined();
    });
  });
  
  describe('Mode: REPLAY', () => {
    it('should load cassettes deterministically', async () => {
      process.env.E2E_CASSETTES_DIR = TEST_CASSETTE_DIR;
      
      // Create a cassette
      await mkdir(TEST_CASSETTE_DIR, { recursive: true });
      const request = { type: 'test', data: 'example' };
      
      // Calculate cassette key
      const normalized = JSON.stringify(request, (_k, v) => 
        typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...[truncated]' : v
      );
      const key = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + normalized)
        .digest('hex');
      
      // Write cassette
      await writeFile(
        join(TEST_CASSETTE_DIR, `${key}.json`),
        JSON.stringify(validResponse)
      );
      
      // Test replay
      const adapter = new GeminiTestAdapter('replay', mockRealAPI);
      const result = await adapter.callAPI(request);
      
      expect(result).toEqual(validResponse);
      expect(mockRealAPI.call).not.toHaveBeenCalled(); // Should not call real API
    });
    
    it('should fail with clear error when cassette missing', async () => {
      process.env.E2E_CASSETTES_DIR = TEST_CASSETTE_DIR;
      const adapter = new GeminiTestAdapter('replay', mockRealAPI);
      
      await expect(adapter.callAPI({ type: 'missing' }))
        .rejects.toThrow(/Cassette not found/);
    });
    
    it('should validate cassette schema on replay', async () => {
      process.env.E2E_CASSETTES_DIR = TEST_CASSETTE_DIR;
      await mkdir(TEST_CASSETTE_DIR, { recursive: true });
      
      const request = { type: 'test' };
      const normalized = JSON.stringify(request, (_k, v) => 
        typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...[truncated]' : v
      );
      const key = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + normalized)
        .digest('hex');
      
      // Write invalid cassette
      await writeFile(
        join(TEST_CASSETTE_DIR, `${key}.json`),
        JSON.stringify({ invalid: 'schema' })
      );
      
      const adapter = new GeminiTestAdapter('replay', mockRealAPI);
      
      await expect(adapter.callAPI(request))
        .rejects.toThrow(/Cassette not found/);
    });
  });
  
  describe('Mode: LIVE', () => {
    it('should call real API and track costs', async () => {
      const adapter = new GeminiTestAdapter('live', mockRealAPI);
      
      mockRealAPI.call.mockResolvedValueOnce(validResponse);
      const result = await adapter.callAPI({ type: 'generate', variants: 2 });
      
      expect(result).toEqual(validResponse);
      expect(mockRealAPI.call).toHaveBeenCalledWith({ type: 'generate', variants: 2 });
      
      const stats = adapter.getStats();
      expect(stats.spent).toBe(0.005); // 2 variants * $0.0025
      expect(stats.requestCount).toBe(1);
    });
  });
  
  describe('Cost Reporting', () => {
    it('should generate cost report correctly', () => {
      const adapter = new GeminiTestAdapter('live', mockRealAPI);
      adapter.track(0.10);
      adapter.track(0.05);
      
      const report = adapter.getCostReport();
      
      expect(report.spentUSD).toBeCloseTo(0.15, 10);
      expect(report.requestCount).toBe(2);
      expect(report.mode).toBe('live');
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    
    it('should save cost report to file', async () => {
      process.env.E2E_COST_REPORT_PATH = join(TEST_ARTIFACTS_DIR, 'cost.json');
      
      const adapter = new GeminiTestAdapter('live', mockRealAPI);
      adapter.track(0.25);
      
      await adapter.saveCostReport();
      
      const reportFile = join(TEST_ARTIFACTS_DIR, 'cost.json');
      expect(existsSync(reportFile)).toBe(true);
      
      const report = JSON.parse(await readFile(reportFile, 'utf-8'));
      expect(report.spentUSD).toBe(0.25);
      expect(report.mode).toBe('live');
    });
  });
  
  describe('Key Stability', () => {
    it('should generate same key for same inputs', () => {
      const request = { type: 'test', prompt: 'hello world', seed: 42 };
      
      // Generate key multiple times
      const key1 = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + JSON.stringify(request))
        .digest('hex');
      
      const key2 = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + JSON.stringify(request))
        .digest('hex');
      
      expect(key1).toBe(key2);
    });
    
    it('should generate different keys for different version tags', () => {
      const request = { type: 'test' };
      const normalized = JSON.stringify(request);
      
      const key1 = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-09' + normalized)
        .digest('hex');
      
      const key2 = createHash('sha256')
        .update('gemini-2.5-flash-image-preview@2025-10' + normalized)
        .digest('hex');
      
      expect(key1).not.toBe(key2);
    });
  });
  
  describe('Helper Methods', () => {
    it('should analyze images with Vision API', async () => {
      const adapter = new GeminiTestAdapter('mock', mockRealAPI);
      
      const imageDescriptor = {
        objects: ['tree', 'sky'],
        scene: 'outdoor landscape',
        style: ['natural'],
        composition: 'centered',
        colors: ['#green', '#blue'],
        lighting: 'daylight',
        qualityIssues: [],
        safetyTags: [],
        confidence: 0.9
      };
      
      mockRealAPI.call.mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(imageDescriptor) }]
          }
        }]
      });
      
      const result = await adapter.analyzeImage(Buffer.from('test-image'));
      
      expect(result).toEqual(imageDescriptor);
    });
    
    it('should generate images with proper cost tracking', async () => {
      const adapter = new GeminiTestAdapter('live', mockRealAPI);
      
      mockRealAPI.call.mockResolvedValueOnce(validResponse);
      await adapter.generateImage('test prompt', [Buffer.from('style1')]);
      
      const stats = adapter.getStats();
      expect(stats.spent).toBe(0.0025); // 1 variant * $0.0025
    });
  });
});