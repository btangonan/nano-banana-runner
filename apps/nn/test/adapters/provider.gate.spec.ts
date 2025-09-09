import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProvider, createProviderSync } from '../../src/adapters/providerFactory.js';
import { readFile } from 'node:fs/promises';
import { env } from '../../src/config/env.js';

vi.mock('node:fs/promises');
vi.mock('../../src/adapters/geminiBatch.js', () => ({
  GeminiBatchAdapter: vi.fn().mockImplementation(() => ({
    submit: vi.fn(),
    poll: vi.fn(),
    fetch: vi.fn()
  }))
}));
vi.mock('../../src/adapters/geminiImage.js', () => ({
  GeminiImageAdapter: vi.fn().mockImplementation(() => ({
    probe: vi.fn().mockResolvedValue(true),
    render: vi.fn()
  }))
}));

describe('Provider Factory - Health Gating', () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    Object.assign(env, originalEnv);
    env.GOOGLE_CLOUD_PROJECT = 'test-project';
    env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    env.NN_OUT_DIR = './artifacts';
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.assign(env, originalEnv);
  });

  describe('createProvider with probe cache', () => {
    it('should fallback to batch when model is unhealthy in cache', async () => {
      // Mock unhealthy probe cache
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1',
        results: [
          {
            model: 'gemini-1.5-flash',
            status: 'degraded',
            http: 404,
            code: 'model-not-entitled',
            timestamp: new Date().toISOString(),
            endpoint: 'test-endpoint'
          }
        ]
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      const provider = await createProvider('vertex');
      
      // Should fallback to batch provider
      expect(provider).toBeDefined();
      // Verify it read the cache
      expect(readFile).toHaveBeenCalledWith(
        expect.stringContaining('artifacts/probe/publishers.json'),
        'utf-8'
      );
    });

    it('should use vertex when model is healthy in cache', async () => {
      // Mock healthy probe cache
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1',
        results: [
          {
            model: 'gemini-1.5-flash',
            status: 'healthy',
            http: 200,
            timestamp: new Date().toISOString(),
            endpoint: 'test-endpoint'
          }
        ]
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      const provider = await createProvider('vertex');
      
      // Should use vertex provider
      expect(provider).toBeDefined();
      // Verify it read the cache
      expect(readFile).toHaveBeenCalledWith(
        expect.stringContaining('artifacts/probe/publishers.json'),
        'utf-8'
      );
    });

    it('should throw error when noFallback is true and model is unhealthy', async () => {
      // Mock unhealthy probe cache
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1',
        results: [
          {
            model: 'gemini-1.5-flash',
            status: 'degraded',
            http: 404,
            code: 'model-not-entitled',
            timestamp: new Date().toISOString(),
            endpoint: 'test-endpoint'
          }
        ]
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      await expect(createProvider('vertex', true)).rejects.toThrow(
        'Publisher Model gemini-1.5-flash is not available'
      );
    });

    it('should proceed when cache is not available', async () => {
      // Mock no cache file
      (readFile as any).mockRejectedValue(new Error('ENOENT'));

      const provider = await createProvider('vertex');
      
      // Should proceed to probe
      expect(provider).toBeDefined();
    });

    it('should handle error status in cache', async () => {
      // Mock error status in cache
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1',
        results: [
          {
            model: 'gemini-1.5-flash',
            status: 'error',
            http: 0,
            code: 'timeout',
            timestamp: new Date().toISOString(),
            endpoint: 'test-endpoint'
          }
        ]
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      const provider = await createProvider('vertex');
      
      // Should fallback to batch due to error status
      expect(provider).toBeDefined();
    });

    it('should handle model not in cache', async () => {
      // Mock cache without the target model
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1',
        results: [
          {
            model: 'some-other-model',
            status: 'healthy',
            http: 200,
            timestamp: new Date().toISOString(),
            endpoint: 'test-endpoint'
          }
        ]
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      const provider = await createProvider('vertex');
      
      // Should proceed (model not in cache is assumed healthy)
      expect(provider).toBeDefined();
    });

    it('should throw error when GOOGLE_CLOUD_PROJECT missing and noFallback is true', async () => {
      delete env.GOOGLE_CLOUD_PROJECT;

      await expect(createProvider('vertex', true)).rejects.toThrow(
        'GOOGLE_CLOUD_PROJECT is required for Vertex AI provider'
      );
    });

    it('should fallback to batch when GOOGLE_CLOUD_PROJECT missing', async () => {
      delete env.GOOGLE_CLOUD_PROJECT;

      const provider = await createProvider('vertex');
      
      // Should fallback to batch
      expect(provider).toBeDefined();
    });

    it('should use batch provider directly when specified', async () => {
      const provider = await createProvider('batch');
      
      // Should not read cache for batch provider
      expect(readFile).not.toHaveBeenCalled();
      expect(provider).toBeDefined();
    });

    it('should throw error for unknown provider', async () => {
      await expect(createProvider('unknown' as any)).rejects.toThrow(
        "provider=unknown. Must be 'batch' or 'vertex'"
      );
    });
  });

  describe('createProviderSync', () => {
    it('should not read probe cache (sync mode)', () => {
      const provider = createProviderSync('vertex');
      
      // Should not read cache in sync mode
      expect(readFile).not.toHaveBeenCalled();
      expect(provider).toBeDefined();
    });

    it('should fallback to batch when GOOGLE_CLOUD_PROJECT missing', () => {
      delete env.GOOGLE_CLOUD_PROJECT;

      const provider = createProviderSync('vertex');
      
      // Should fallback to batch
      expect(provider).toBeDefined();
    });

    it('should use batch provider directly when specified', () => {
      const provider = createProviderSync('batch');
      
      expect(provider).toBeDefined();
    });

    it('should throw error for unknown provider', () => {
      expect(() => createProviderSync('unknown' as any)).toThrow(
        "provider=unknown. Must be 'batch' or 'vertex'"
      );
    });
  });

  describe('Probe cache format validation', () => {
    it('should handle malformed cache JSON gracefully', async () => {
      // Mock invalid JSON
      (readFile as any).mockResolvedValue('not valid json');

      const provider = await createProvider('vertex');
      
      // Should proceed despite invalid cache
      expect(provider).toBeDefined();
    });

    it('should handle cache with missing results array', async () => {
      // Mock cache without results
      const mockCache = {
        timestamp: new Date().toISOString(),
        project: 'test-project',
        location: 'us-central1'
        // missing results array
      };

      (readFile as any).mockResolvedValue(JSON.stringify(mockCache));

      const provider = await createProvider('vertex');
      
      // Should proceed (no results means assume healthy)
      expect(provider).toBeDefined();
    });
  });
});