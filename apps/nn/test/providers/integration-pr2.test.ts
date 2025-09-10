import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAnalyzeProvider, DEFAULT_PROVIDER_CONFIG } from '../../src/core/providers/factory.js';
import type { ProviderFactoryConfig } from '../../src/core/providers/types.js';

// Mock fetch for GeminiProvider
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PR-2 Integration: Gemini Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Factory Integration', () => {
    it('should create GeminiProvider when requested', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        killSwitch: false,
      };
      
      const provider = createAnalyzeProvider(config);
      
      expect(provider.name).toBe('gemini');
      expect(typeof provider.analyze).toBe('function');
      expect(typeof provider.analyzeBatch).toBe('function');
      expect(typeof provider.estimateCost).toBe('function');
    });

    it('should respect kill-switch for Gemini provider', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        killSwitch: true, // Kill switch enabled
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Should fallback to Sharp despite Gemini request
      expect(provider.name).toBe('sharp');
    });

    it('should create cached Gemini provider when caching enabled', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        cacheEnabled: true,
        maxCacheSize: 128,
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Should still present as Gemini provider
      expect(provider.name).toBe('gemini');
    });

    it('should create rollout provider with Gemini primary and Sharp fallback', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        rolloutPercent: 50,
        cacheEnabled: true,
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Note: With current implementation, rollout provider will show primary provider name
      expect(provider.name).toBe('gemini');
    });
  });

  describe('Cost Estimation', () => {
    it('should provide different cost estimates for Sharp vs Gemini', async () => {
      const sharpProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      });
      
      const geminiProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      const [sharpCost, geminiCost] = await Promise.all([
        sharpProvider.estimateCost(10),
        geminiProvider.estimateCost(10),
      ]);
      
      expect(sharpCost.estimatedCost).toBe(0); // Sharp is free
      expect(geminiCost.estimatedCost).toBeGreaterThan(0); // Gemini has cost
      expect(sharpCost.provider).toBe('sharp');
      expect(geminiCost.provider).toBe('gemini');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate Sharp provider successfully', async () => {
      const provider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      });
      
      if (provider.validateConfig) {
        const isValid = await provider.validateConfig();
        expect(isValid).toBe(true);
      }
    });

    it('should handle Gemini provider validation based on proxy availability', async () => {
      const provider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      // Mock successful proxy response for validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          costEstimate: {
            imageCount: 1,
            estimatedCost: 0.0025,
            provider: 'gemini',
          }
        }),
      });
      
      if (provider.validateConfig) {
        const isValid = await provider.validateConfig();
        expect(isValid).toBe(true);
      }
    });

    it('should handle Gemini provider validation failure', async () => {
      const provider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      // Mock proxy unavailable
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      
      if (provider.validateConfig) {
        const isValid = await provider.validateConfig();
        expect(isValid).toBe(false);
      }
    });
  });

  describe('Interface Consistency', () => {
    it('should maintain consistent interface across Sharp and Gemini providers', () => {
      const sharpProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      });
      
      const geminiProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      // Both should implement the same interface
      const sharpMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(sharpProvider));
      const geminiMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(geminiProvider));
      
      // Core interface methods should be present in both
      const requiredMethods = ['analyze', 'analyzeBatch', 'estimateCost'];
      
      requiredMethods.forEach(method => {
        expect(typeof (sharpProvider as any)[method]).toBe('function');
        expect(typeof (geminiProvider as any)[method]).toBe('function');
      });
      
      // Both should have name and config properties
      expect(sharpProvider.name).toBeDefined();
      expect(geminiProvider.name).toBeDefined();
      expect(sharpProvider.config).toBeDefined();
      expect(geminiProvider.config).toBeDefined();
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle unsupported provider gracefully', () => {
      const config = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'unsupported' as any,
      };
      
      // Should fallback to Sharp without throwing
      const provider = createAnalyzeProvider(config);
      expect(provider.name).toBe('sharp');
    });
  });

  describe('Caching Behavior', () => {
    it('should support caching for both provider types', async () => {
      const sharpConfig: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
        cacheEnabled: true,
        maxCacheSize: 64,
      };
      
      const geminiConfig: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        cacheEnabled: true,
        maxCacheSize: 64,
      };
      
      const sharpProvider = createAnalyzeProvider(sharpConfig);
      const geminiProvider = createAnalyzeProvider(geminiConfig);
      
      expect(sharpProvider.name).toBe('sharp');
      expect(geminiProvider.name).toBe('gemini');
      
      // Both should still provide their core interface
      expect(typeof sharpProvider.analyze).toBe('function');
      expect(typeof geminiProvider.analyze).toBe('function');
    });
  });

  describe('Cleanup Operations', () => {
    it('should support cleanup for both provider types', async () => {
      const sharpProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      });
      
      const geminiProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      // Both should support cleanup without throwing
      if (sharpProvider.cleanup) {
        await expect(sharpProvider.cleanup()).resolves.toBeUndefined();
      }
      
      if (geminiProvider.cleanup) {
        await expect(geminiProvider.cleanup()).resolves.toBeUndefined();
      }
    });
  });

  describe('Metric Compatibility', () => {
    it('should provide consistent metrics interface', () => {
      const sharpProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      });
      
      const geminiProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
      });
      
      // Both should provide getMetrics if available
      if ('getMetrics' in sharpProvider) {
        const sharpMetrics = (sharpProvider as any).getMetrics();
        expect(sharpMetrics).toHaveProperty('requestsTotal');
      }
      
      if ('getMetrics' in geminiProvider) {
        const geminiMetrics = (geminiProvider as any).getMetrics();
        expect(geminiMetrics).toHaveProperty('requestsTotal');
      }
    });
  });
});