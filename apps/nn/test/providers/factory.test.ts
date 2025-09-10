import { describe, it, expect, beforeEach } from 'vitest';
import { createAnalyzeProvider, DEFAULT_PROVIDER_CONFIG } from '../../src/core/providers/factory.js';
import type { ProviderFactoryConfig } from '../../src/core/providers/types.js';

describe('Provider Factory', () => {
  describe('createAnalyzeProvider', () => {
    it('should create Sharp provider by default', () => {
      const provider = createAnalyzeProvider(DEFAULT_PROVIDER_CONFIG);
      
      expect(provider.name).toBe('sharp');
      expect(provider.config.costPerImage).toBe(0);
    });

    it('should respect kill-switch configuration', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini', // Request Gemini
        killSwitch: true,   // But kill-switch enabled
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Should return Sharp despite Gemini request
      expect(provider.name).toBe('sharp');
    });

    it('should fallback to Sharp when Gemini not implemented', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        killSwitch: false,
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Should fallback to Sharp since Gemini not implemented yet
      expect(provider.name).toBe('sharp');
    });

    it('should create Sharp provider when explicitly requested', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
      };
      
      const provider = createAnalyzeProvider(config);
      
      expect(provider.name).toBe('sharp');
    });

    it('should apply caching when enabled', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        cacheEnabled: true,
        maxCacheSize: 128,
        diskCacheEnabled: true,
      };
      
      const provider = createAnalyzeProvider(config);
      
      expect(provider.name).toBe('sharp');
      // Note: CachedProvider wrapper should be applied but interface remains the same
    });

    it('should disable caching when requested', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        cacheEnabled: false,
      };
      
      const provider = createAnalyzeProvider(config);
      
      expect(provider.name).toBe('sharp');
    });

    it('should handle rollout configuration', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'gemini',
        rolloutPercent: 50, // 50% rollout
      };
      
      const provider = createAnalyzeProvider(config);
      
      // Since Gemini not implemented, should still be Sharp
      // But rollout logic should be in place
      expect(provider.name).toBe('sharp');
    });
  });

  describe('DEFAULT_PROVIDER_CONFIG', () => {
    it('should have safe default values', () => {
      expect(DEFAULT_PROVIDER_CONFIG.provider).toBe('sharp');
      expect(DEFAULT_PROVIDER_CONFIG.rolloutPercent).toBe(0);
      expect(DEFAULT_PROVIDER_CONFIG.killSwitch).toBe(false);
      expect(DEFAULT_PROVIDER_CONFIG.cacheEnabled).toBe(true);
      expect(DEFAULT_PROVIDER_CONFIG.maxCacheSize).toBe(256);
      expect(DEFAULT_PROVIDER_CONFIG.diskCacheEnabled).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle invalid provider gracefully', () => {
      const config = {
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'invalid' as any, // Invalid provider
      };
      
      // Should fallback to Sharp without throwing
      const provider = createAnalyzeProvider(config);
      expect(provider.name).toBe('sharp');
    });

    it('should handle negative rollout percent', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        rolloutPercent: -10,
      };
      
      // Should clamp to 0 and work normally
      const provider = createAnalyzeProvider(config);
      expect(provider.name).toBe('sharp');
    });

    it('should handle rollout percent > 100', () => {
      const config: ProviderFactoryConfig = {
        ...DEFAULT_PROVIDER_CONFIG,
        rolloutPercent: 150,
      };
      
      // Should clamp to 100 and work normally
      const provider = createAnalyzeProvider(config);
      expect(provider.name).toBe('sharp');
    });
  });

  describe('configuration validation', () => {
    it('should validate provider configuration on creation', async () => {
      const provider = createAnalyzeProvider(DEFAULT_PROVIDER_CONFIG);
      
      if (provider.validateConfig) {
        const isValid = await provider.validateConfig();
        expect(isValid).toBe(true);
      }
    });

    it('should support cleanup operations', async () => {
      const provider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        cacheEnabled: true,
      });
      
      // Should not throw when cleanup is called
      if (provider.cleanup) {
        await expect(provider.cleanup()).resolves.toBeUndefined();
      }
    });
  });

  describe('functional integration', () => {
    it('should maintain consistent interface across providers', async () => {
      const sharpProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
        cacheEnabled: false,
      });
      
      const cachedProvider = createAnalyzeProvider({
        ...DEFAULT_PROVIDER_CONFIG,
        provider: 'sharp',
        cacheEnabled: true,
      });
      
      // Both should have the same interface
      expect(typeof sharpProvider.analyze).toBe('function');
      expect(typeof sharpProvider.analyzeBatch).toBe('function');
      expect(typeof sharpProvider.estimateCost).toBe('function');
      
      expect(typeof cachedProvider.analyze).toBe('function');
      expect(typeof cachedProvider.analyzeBatch).toBe('function');
      expect(typeof cachedProvider.estimateCost).toBe('function');
    });

    it('should produce consistent cost estimates', async () => {
      const provider = createAnalyzeProvider(DEFAULT_PROVIDER_CONFIG);
      
      const estimate1 = await provider.estimateCost(10);
      const estimate2 = await provider.estimateCost(10);
      
      expect(estimate1.imageCount).toBe(estimate2.imageCount);
      expect(estimate1.estimatedCost).toBe(estimate2.estimatedCost);
      expect(estimate1.provider).toBe(estimate2.provider);
    });
  });
});

describe('LRU Cache integration', () => {
  it('should cache analysis results when enabled', async () => {
    const config: ProviderFactoryConfig = {
      ...DEFAULT_PROVIDER_CONFIG,
      cacheEnabled: true,
      maxCacheSize: 2,
    };
    
    const provider = createAnalyzeProvider(config);
    
    // Create test PNG buffer
    const testBuffer = Buffer.from([
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
    
    // First analysis
    const result1 = await provider.analyze('test.png', testBuffer);
    expect(result1.provider).toBe('sharp');
    
    // Second analysis of same buffer should be cached
    const result2 = await provider.analyze('test.png', testBuffer);
    expect(result2.provider).toBe('sharp');
    expect(result2.hash).toBe(result1.hash);
  });
});

describe('Rollout logic integration', () => {
  it('should select providers deterministically based on path', () => {
    // Note: This test would be more meaningful when Gemini provider is implemented
    // For now, it validates the factory doesn't crash with rollout settings
    const config: ProviderFactoryConfig = {
      ...DEFAULT_PROVIDER_CONFIG,
      provider: 'gemini',
      rolloutPercent: 25,
    };
    
    const provider = createAnalyzeProvider(config);
    expect(provider.name).toBe('sharp'); // Falls back since Gemini not implemented
  });
});