import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest';
import { createProvider, UnifiedProvider } from '../../src/adapters/providerFactory.js';
import { ProviderName } from '../../src/types.js';

// Mock the env module with a factory function
vi.mock('../../src/config/env.js', () => ({
  env: {
    NN_PROVIDER: 'batch',
    GOOGLE_CLOUD_PROJECT: '',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
  }
}));

// Mock the logger
vi.mock('../../src/logger.js', () => ({
  createOperationLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

// Mock the adapter classes
vi.mock('../../src/adapters/geminiBatch.js', () => ({
  GeminiBatchAdapter: vi.fn(() => ({
    submit: vi.fn().mockResolvedValue({ jobId: 'batch-123', estCount: 10 })
  }))
}));

vi.mock('../../src/adapters/geminiImage.js', () => ({
  GeminiImageAdapter: vi.fn(() => ({
    render: vi.fn().mockResolvedValue({ 
      results: [{ id: '1', imageUrl: 'test.png' }],
      costPlan: { estimatedCost: '0.01', estimatedTime: '30s' }
    })
  }))
}));

// Mock the mock image adapter
vi.mock('../../src/adapters/mockImage.js', () => ({
  MockImageAdapter: vi.fn(() => ({
    render: vi.fn().mockResolvedValue({ 
      results: [{ id: '1', imageUrl: 'mock.png' }]
    })
  }))
}));

describe('Provider Factory', () => {
  let mockEnv: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    // Get the mocked env module
    const envModule = await import('../../src/config/env.js');
    mockEnv = envModule.env;
    // Reset env defaults
    mockEnv.NN_PROVIDER = 'batch';
    mockEnv.GOOGLE_CLOUD_PROJECT = '';
  });

  describe('Provider Selection Logic', () => {
    it('should use default batch provider when no override specified', () => {
      mockEnv.NN_PROVIDER = 'batch';
      
      const provider = createProvider();
      
      expect(provider).toBeDefined();
      // The provider should be created without errors
    });

    it('should use default vertex provider when configured in env', () => {
      mockEnv.NN_PROVIDER = 'vertex';
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const provider = createProvider();
      
      expect(provider).toBeDefined();
    });

    it('should override to batch when per-job override specified', () => {
      mockEnv.NN_PROVIDER = 'vertex';
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const provider = createProvider('batch');
      
      expect(provider).toBeDefined();
      // Should create batch provider despite vertex default
    });

    it('should override to vertex when per-job override specified', () => {
      mockEnv.NN_PROVIDER = 'batch';
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const provider = createProvider('vertex');
      
      expect(provider).toBeDefined();
      // Should create vertex provider despite batch default
    });

    it('should throw RFC7807 error for vertex provider without ADC configuration', () => {
      mockEnv.GOOGLE_CLOUD_PROJECT = ''; // No ADC configuration
      
      expect(() => createProvider('vertex')).toThrow();
      
      try {
        createProvider('vertex');
      } catch (error) {
        expect(error.type).toBe('about:blank');
        expect(error.title).toBe('Vertex provider requires ADC configuration');
        expect(error.detail).toContain('GOOGLE_CLOUD_PROJECT is required');
        expect(error.status).toBe(400);
      }
    });

    it('should throw error for unknown provider', () => {
      expect(() => createProvider('unknown' as ProviderName)).toThrow();
      
      try {
        createProvider('unknown' as ProviderName);
      } catch (error) {
        expect(error.type).toBe('about:blank');
        expect(error.title).toBe('Unknown provider');
        expect(error.detail).toContain('provider=unknown');
        expect(error.status).toBe(400);
      }
    });
  });

  describe('Provider Priority Logic', () => {
    it('should prioritize per-job override over environment default', () => {
      mockEnv.NN_PROVIDER = 'vertex';
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      // Override should take precedence
      const batchProvider = createProvider('batch');
      const vertexProvider = createProvider('vertex');
      
      expect(batchProvider).toBeDefined();
      expect(vertexProvider).toBeDefined();
      // Both should be created successfully regardless of env default
    });

    it('should fall back to environment default when no override provided', () => {
      mockEnv.NN_PROVIDER = 'batch';
      
      const provider = createProvider();
      
      expect(provider).toBeDefined();
      // Should use batch from environment
    });

    it('should fall back to batch when environment is not vertex', () => {
      mockEnv.NN_PROVIDER = 'invalid' as any;
      
      const provider = createProvider();
      
      expect(provider).toBeDefined();
      // Should default to batch for invalid env values
    });
  });

  describe('Unified Provider Interface', () => {
    let provider: UnifiedProvider;

    beforeEach(() => {
      provider = createProvider('batch');
    });

    it('should handle batch provider dry-run generation', async () => {
      const result = await provider.generate({
        rows: [{ id: '1', prompt: 'test prompt' }],
        variants: 1,
        styleOnly: true,
        styleRefs: [],
        runMode: 'dry_run'
      });

      expect(result.type).toBe('batch_job');
      if (result.type === 'batch_job') {
        expect(result.jobId).toMatch(/^dry-run-\d+$/);
        expect(result.estCount).toBe(1);
      }
    });

    it('should handle vertex provider synchronous generation', async () => {
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      const vertexProvider = createProvider('vertex');

      const result = await vertexProvider.generate({
        rows: [{ id: '1', prompt: 'test prompt' }],
        variants: 1,
        styleOnly: true,
        styleRefs: [],
        runMode: 'live'
      });

      expect(result.type).toBe('direct_result');
      if (result.type === 'direct_result') {
        expect(result.result.results).toHaveLength(1);
        expect(result.result.results[0].id).toBe('1');
      }
    });

    it('should validate generate request parameters', async () => {
      const validRequest = {
        rows: [{ id: '1', prompt: 'test' }],
        variants: 2 as 1 | 2 | 3,
        styleOnly: true,
        styleRefs: ['style1.png', 'style2.png'],
        runMode: 'live' as 'dry_run' | 'live'
      };

      const result = await provider.generate(validRequest);
      
      expect(result).toBeDefined();
      expect(result.type).toMatch(/^(batch_job|direct_result)$/);
    });

    it('should handle empty prompt rows', async () => {
      const result = await provider.generate({
        rows: [],
        variants: 1,
        styleOnly: true,
        styleRefs: [],
        runMode: 'dry_run'
      });

      expect(result.type).toBe('batch_job');
      if (result.type === 'batch_job') {
        expect(result.estCount).toBe(0);
      }
    });

    it('should calculate estimated count correctly', async () => {
      const result = await provider.generate({
        rows: [
          { id: '1', prompt: 'test 1' },
          { id: '2', prompt: 'test 2' },
          { id: '3', prompt: 'test 3' }
        ],
        variants: 2,
        styleOnly: true,
        styleRefs: [],
        runMode: 'dry_run'
      });

      expect(result.type).toBe('batch_job');
      if (result.type === 'batch_job') {
        expect(result.estCount).toBe(6); // 3 prompts × 2 variants
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle adapter initialization errors gracefully', () => {
      // Test with missing required configuration
      mockEnv.GOOGLE_CLOUD_PROJECT = '';
      
      expect(() => {
        createProvider('vertex');
      }).toThrow();
    });

    it('should provide meaningful error messages for configuration issues', () => {
      mockEnv.GOOGLE_CLOUD_PROJECT = '';
      
      try {
        createProvider('vertex');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.detail).toContain('GOOGLE_CLOUD_PROJECT is required');
        expect(error.detail).toContain('Configure ADC or use --provider batch');
      }
    });
  });

  describe('Environment Integration', () => {
    it('should respect NN_PROVIDER environment variable as default', () => {
      mockEnv.NN_PROVIDER = 'vertex';
      mockEnv.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      // Should not throw with proper configuration
      expect(() => createProvider()).not.toThrow();
    });

    it('should handle missing environment gracefully', () => {
      mockEnv.NN_PROVIDER = 'batch';
      mockEnv.GOOGLE_CLOUD_PROJECT = '';
      
      // Batch provider should work without ADC
      expect(() => createProvider()).not.toThrow();
    });
  });
});