import { describe, it, expect, beforeEach } from 'vitest';
import type { ImageDescriptor } from '../../../src/types.js';
import type { RemixProvider, RemixContext } from '../../../src/core/remix/providers/index.js';
import { HeuristicRemixProvider } from '../../../src/core/remix/providers/index.js';
import { generatePrompts, setRemixProvider, getRemixProvider } from '../../../src/core/remix/index.js';

describe('RemixProvider Interface', () => {
  describe('HeuristicRemixProvider', () => {
    let provider: HeuristicRemixProvider;
    
    beforeEach(() => {
      provider = new HeuristicRemixProvider();
    });
    
    it('should have correct name and version', () => {
      expect(provider.name).toBe('heuristic');
      expect(provider.version).toBe('1.0.0');
    });
    
    it('should be configured by default', () => {
      expect(provider.isConfigured()).toBe(true);
    });
    
    it('should generate prompts from descriptors', async () => {
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/image1.jpg',
          hash: 'abc123',
          width: 1920,
          height: 1080,
          format: 'jpeg',
          palette: ['#ff0000', '#00ff00'],
          subjects: ['person', 'landscape'],
          style: ['vibrant', 'modern'],
          lighting: ['natural light', 'golden hour']
        }
      ];
      
      const context: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 5,
          seed: 42,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const result = await provider.generatePrompts(context);
      
      expect(result.prompts).toHaveLength(5);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.provider).toBe('heuristic');
      expect(result.metadata?.totalGenerated).toBe(5);
      expect(result.metadata?.avgPerImage).toBe(5);
      
      // Check that prompts have required fields
      result.prompts.forEach(prompt => {
        expect(prompt.prompt).toContain('Use reference images strictly for style');
        expect(prompt.sourceImage).toBe('/test/image1.jpg');
        expect(prompt.tags).toBeDefined();
        expect(prompt.seed).toBeDefined();
        expect(prompt._meta?.idempotencyKey).toBeDefined();
      });
    });
    
    it('should handle ultra-cinematic format with singular subject', async () => {
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/cinematic.jpg',
          hash: 'xyz789',
          width: 3840,
          height: 2160,
          format: 'jpeg',
          palette: ['#1a3b5c', '#ff6b35'],
          // Ultra-cinematic format uses singular 'subject'
          subject: 'A lone figure standing in water at twilight',
          style: ['cinematic', 'atmospheric'],
          lighting: {
            quality: 'soft',
            timeOfDay: 'golden hour',
            direction: 'backlighting'
          } as any
        }
      ];
      
      const context: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 3,
          seed: 123,
          maxStyleAdj: 2,
          maxLighting: 2
        }
      };
      
      const result = await provider.generatePrompts(context);
      
      expect(result.prompts).toHaveLength(3);
      
      // Verify it handles the singular subject field
      result.prompts.forEach(prompt => {
        expect(prompt.prompt).toContain('A lone figure standing in water at twilight');
      });
    });
    
    it('should skip descriptors with errors', async () => {
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/good.jpg',
          hash: 'good',
          width: 1920,
          height: 1080,
          palette: [],
          subjects: ['test'],
          style: [],
          lighting: []
        },
        {
          path: '/test/bad.jpg',
          hash: 'bad',
          width: 0,
          height: 0,
          palette: [],
          subjects: [],
          style: [],
          lighting: [],
          errors: ['Failed to analyze']
        }
      ];
      
      const context: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 2,
          seed: 42,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const result = await provider.generatePrompts(context);
      
      // Should only generate prompts for the good descriptor
      expect(result.prompts).toHaveLength(2);
      expect(result.prompts.every(p => p.sourceImage === '/test/good.jpg')).toBe(true);
    });
  });
  
  describe('generatePrompts backward compatibility', () => {
    beforeEach(() => {
      // Reset to default provider
      setRemixProvider(new HeuristicRemixProvider());
    });
    
    it('should work with the legacy generatePrompts function', async () => {
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/legacy.jpg',
          hash: 'legacy123',
          width: 1920,
          height: 1080,
          palette: ['#000000'],
          subjects: ['cat'],
          style: ['realistic'],
          lighting: ['soft light']
        }
      ];
      
      const prompts = await generatePrompts(descriptors, {
        maxPerImage: 10,
        seed: 999,
        maxStyleAdj: 3,
        maxLighting: 2
      });
      
      expect(prompts).toHaveLength(10);
      expect(prompts[0].sourceImage).toBe('/test/legacy.jpg');
    });
    
    it('should use custom provider when set', async () => {
      // Create a mock provider
      const mockProvider: RemixProvider = {
        name: 'mock',
        version: '1.0.0',
        async generatePrompts(context: RemixContext) {
          return {
            prompts: [{
              prompt: 'mock prompt',
              sourceImage: 'mock.jpg',
              tags: ['mock'],
              seed: 0
            }],
            metadata: {
              provider: 'mock',
              version: '1.0.0',
              avgPerImage: 1,
              totalGenerated: 1
            }
          };
        },
        isConfigured() {
          return true;
        }
      };
      
      setRemixProvider(mockProvider);
      expect(getRemixProvider().name).toBe('mock');
      
      const prompts = await generatePrompts([], {
        maxPerImage: 5,
        seed: 42,
        maxStyleAdj: 3,
        maxLighting: 2
      });
      
      expect(prompts).toHaveLength(1);
      expect(prompts[0].prompt).toBe('mock prompt');
    });
  });
  
  describe('Deterministic behavior', () => {
    it('should generate identical prompts for same seed', async () => {
      const provider = new HeuristicRemixProvider();
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/deterministic.jpg',
          hash: 'det123',
          width: 1920,
          height: 1080,
          palette: ['#ff0000'],
          subjects: ['dog', 'park'],
          style: ['bright', 'sunny'],
          lighting: ['natural light']
        }
      ];
      
      const context1: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 5,
          seed: 42,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const context2: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 5,
          seed: 42,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const result1 = await provider.generatePrompts(context1);
      const result2 = await provider.generatePrompts(context2);
      
      // Should generate identical prompts
      expect(result1.prompts).toEqual(result2.prompts);
    });
    
    it('should generate different prompts for different seeds', async () => {
      const provider = new HeuristicRemixProvider();
      const descriptors: ImageDescriptor[] = [
        {
          path: '/test/random.jpg',
          hash: 'rand456',
          width: 1920,
          height: 1080,
          palette: ['#0000ff'],
          subjects: ['cat'],
          style: ['modern'],
          lighting: ['studio lighting']
        }
      ];
      
      const context1: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 3,
          seed: 42,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const context2: RemixContext = {
        descriptors,
        options: {
          maxPerImage: 3,
          seed: 99,
          maxStyleAdj: 3,
          maxLighting: 2
        }
      };
      
      const result1 = await provider.generatePrompts(context1);
      const result2 = await provider.generatePrompts(context2);
      
      // Should generate different prompts
      expect(result1.prompts).not.toEqual(result2.prompts);
      
      // But same structure
      expect(result1.prompts.length).toBe(result2.prompts.length);
    });
  });
});