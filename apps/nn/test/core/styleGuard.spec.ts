import { describe, it, expect } from 'vitest';
import { 
  enforceStyleOnly, 
  validateStyleOnlyCompliance,
  buildStyleOnlyMessage 
} from '../../src/core/styleGuard.js';
import type { ImageGenerationRequest } from '../../src/types.js';

describe('StyleGuard Module', () => {
  describe('buildStyleOnlyMessage', () => {
    it('should build proper style-only system message', () => {
      const message = buildStyleOnlyMessage();
      
      expect(message.role).toBe('system');
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].text).toContain('style, palette, texture');
      expect(message.parts[0].text).toContain('NOT copy subject');
    });
  });
  
  describe('enforceStyleOnly', () => {
    it('should add style-only message to request', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful landscape',
        params: {
          numberOfImages: 1,
          aspectRatio: '16:9'
        }
      };
      
      const enforced = enforceStyleOnly(request);
      
      expect(enforced.contents).toBeDefined();
      expect(enforced.contents).toHaveLength(1);
      expect(enforced.contents![0].role).toBe('system');
      expect(enforced.contents![0].parts[0].text).toContain('style, palette');
    });
    
    it('should preserve existing contents', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful landscape',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'existing message' }]
          }
        ],
        params: {
          numberOfImages: 1
        }
      };
      
      const enforced = enforceStyleOnly(request);
      
      expect(enforced.contents).toHaveLength(2);
      expect(enforced.contents![0].role).toBe('system');
      expect(enforced.contents![1].role).toBe('user');
      expect(enforced.contents![1].parts[0].text).toBe('existing message');
    });
    
    it('should handle request with reference images', () => {
      const request: ImageGenerationRequest = {
        prompt: 'Generate art',
        referenceImages: [
          {
            referenceImage: {
              referenceType: 'STYLE' as const,
              referenceImageCandidate: {
                referenceImage: 'base64data'
              }
            }
          }
        ],
        params: {
          numberOfImages: 2
        }
      };
      
      const enforced = enforceStyleOnly(request);
      
      expect(enforced.contents).toBeDefined();
      expect(enforced.referenceImages).toBe(request.referenceImages);
    });
  });
  
  describe('validateStyleOnlyCompliance', () => {
    it('should detect subject copying in prompt', () => {
      const prompt = 'Create an exact copy of this image';
      const result = validateStyleOnlyCompliance(prompt);
      
      expect(result.compliant).toBe(false);
      expect(result.issues).toContain('Prompt may encourage direct copying');
    });
    
    it('should detect replication keywords', () => {
      const prompts = [
        'Replicate this composition',
        'Duplicate the layout',
        'Mirror the exact pose',
        'Clone this design'
      ];
      
      prompts.forEach(prompt => {
        const result = validateStyleOnlyCompliance(prompt);
        expect(result.compliant).toBe(false);
        expect(result.issues.length).toBeGreaterThan(0);
      });
    });
    
    it('should accept style-focused prompts', () => {
      const prompts = [
        'In the style of impressionism',
        'Using vibrant colors and textures',
        'With a moody atmosphere',
        'Inspired by art nouveau aesthetics'
      ];
      
      prompts.forEach(prompt => {
        const result = validateStyleOnlyCompliance(prompt);
        expect(result.compliant).toBe(true);
        expect(result.issues).toHaveLength(0);
      });
    });
    
    it('should handle empty prompt', () => {
      const result = validateStyleOnlyCompliance('');
      
      expect(result.compliant).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
    
    it('should be case-insensitive', () => {
      const prompt = 'EXACT COPY of the reference';
      const result = validateStyleOnlyCompliance(prompt);
      
      expect(result.compliant).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
    
    it('should detect "same as" pattern', () => {
      const prompt = 'Make it the same as the original';
      const result = validateStyleOnlyCompliance(prompt);
      
      expect(result.compliant).toBe(false);
      expect(result.issues).toContain('Prompt may encourage direct copying');
    });
  });
});