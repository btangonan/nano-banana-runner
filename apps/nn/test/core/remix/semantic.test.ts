import { describe, it, expect } from 'vitest';
import { extractComponents, simplifyDescription, extractKeywords } from '../../../src/core/remix/semantic/extractor.js';
import { getSynonym, getAllSynonyms } from '../../../src/core/remix/semantic/synonyms.js';
import { generateFromTemplate, jaccardSimilarity } from '../../../src/core/remix/semantic/templates.js';
import { HeuristicRemixProvider } from '../../../src/core/remix/providers/heuristic.js';
import type { ImageDescriptor } from '../../../src/types.js';
import type { RemixContext } from '../../../src/core/remix/providers/types.js';

describe('Semantic Extraction', () => {
  describe('extractComponents', () => {
    it('should extract components from ultra-cinematic description', () => {
      const description = 'A lone figure standing in water at twilight';
      const components = extractComponents(description);
      
      expect(components.entities).toContain('figure');
      expect(components.actions).toContain('standing');
      expect(components.settings).toContain('water');
      expect(components.times).toContain('twilight');
      expect(components.descriptors).toContain('lone');
    });
    
    it('should extract multiple entities and actions', () => {
      const description = 'Two people walking and talking on the beach';
      const components = extractComponents(description);
      
      expect(components.entities).toContain('people');
      expect(components.actions).toContain('walking');
      expect(components.actions).toContain('talking');
      expect(components.settings).toContain('beach');
    });
    
    it('should handle complex cinematic descriptions', () => {
      const description = 'A solitary silhouette gazing at the horizon during golden hour, waves gently lapping at their feet';
      const components = extractComponents(description);
      
      expect(components.entities).toContain('silhouette');
      expect(components.actions).toContain('gazing');
      expect(components.settings).toContain('horizon');
      expect(components.times).toContain('golden hour');
      expect(components.descriptors).toContain('solitary');
    });
    
    it('should provide defaults for empty descriptions', () => {
      const components = extractComponents('');
      
      expect(components.entities).toEqual(['subject']);
      expect(components.actions).toEqual(['existing']);
      expect(components.settings).toEqual(['environment']);
      expect(components.descriptors).toEqual(['abstract']);
    });
  });
  
  describe('simplifyDescription', () => {
    it('should extract first sentence from multi-sentence description', () => {
      const description = 'A person walking on the beach. The sun is setting. Birds fly overhead.';
      const simplified = simplifyDescription(description);
      
      expect(simplified).toBe('A person walking on the beach');
    });
    
    it('should remove parenthetical information', () => {
      const description = 'A figure (possibly female) standing in water (ocean or lake)';
      const simplified = simplifyDescription(description);
      
      expect(simplified).toBe('A figure  standing in water');
    });
  });
  
  describe('extractKeywords', () => {
    it('should extract content words excluding stop words', () => {
      const text = 'The lone figure is standing in the water';
      const keywords = extractKeywords(text);
      
      expect(keywords).toContain('lone');
      expect(keywords).toContain('figure');
      expect(keywords).toContain('standing');
      expect(keywords).toContain('water');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('is');
      expect(keywords).not.toContain('in');
    });
  });
});

describe('Synonym Dictionaries', () => {
  describe('getSynonym', () => {
    it('should return synonyms for known words', () => {
      expect(getSynonym('person', 0)).toBe('individual');
      expect(getSynonym('person', 1)).toBe('figure');
      expect(getSynonym('standing', 0)).toBe('positioned');
      expect(getSynonym('water', 0)).toBe('ocean');
      expect(getSynonym('twilight', 0)).toBe('dusk');
    });
    
    it('should return original word if no synonyms exist', () => {
      expect(getSynonym('unknown', 0)).toBe('unknown');
    });
    
    it('should cycle through synonyms with index', () => {
      const synonyms = ['individual', 'figure', 'silhouette', 'character', 'subject', 'being'];
      synonyms.forEach((expected, index) => {
        expect(getSynonym('person', index)).toBe(expected);
      });
    });
  });
  
  describe('getAllSynonyms', () => {
    it('should return all synonyms for a word', () => {
      const synonyms = getAllSynonyms('person');
      expect(synonyms).toContain('individual');
      expect(synonyms).toContain('figure');
      expect(synonyms).toContain('silhouette');
      expect(synonyms.length).toBeGreaterThan(3);
    });
    
    it('should return word itself if no synonyms', () => {
      const synonyms = getAllSynonyms('xyz123');
      expect(synonyms).toEqual(['xyz123']);
    });
  });
});

describe('Template Generation', () => {
  // Mock RNG for deterministic testing
  const mockRNG = {
    next: () => 0.5,
    choice: <T>(array: T[]): T => array[0]!
  };
  
  describe('generateFromTemplate', () => {
    it('should generate varied prompts from components', () => {
      const components = {
        entities: ['figure'],
        actions: ['standing'],
        settings: ['water'],
        descriptors: ['lone'],
        times: ['twilight'],
        raw: 'A lone figure standing in water at twilight'
      };
      
      const prompt1 = generateFromTemplate(components, mockRNG);
      expect(prompt1).toBeTruthy();
      expect(prompt1).not.toBe(components.raw); // Should be different from original
    });
    
    it('should avoid similar prompts', () => {
      const components = {
        entities: ['person', 'figure'],
        actions: ['walking', 'moving'],
        settings: ['beach', 'shore'],
        descriptors: ['solitary'],
        times: ['sunset'],
        raw: 'original'
      };
      
      const usedPrompts = new Set<string>();
      const prompt1 = generateFromTemplate(components, mockRNG, usedPrompts);
      usedPrompts.add(prompt1);
      
      const prompt2 = generateFromTemplate(components, mockRNG, usedPrompts);
      expect(prompt2).not.toBe(prompt1);
    });
  });
  
  describe('jaccardSimilarity', () => {
    it('should calculate similarity correctly', () => {
      expect(jaccardSimilarity('cat dog', 'cat dog')).toBe(1);
      expect(jaccardSimilarity('cat', 'dog')).toBe(0);
      expect(jaccardSimilarity('cat dog', 'cat bird')).toBeCloseTo(0.33, 1);
    });
    
    it('should be case insensitive', () => {
      expect(jaccardSimilarity('CAT DOG', 'cat dog')).toBe(1);
    });
  });
});

describe('HeuristicRemixProvider with Semantic Remixing', () => {
  it('should generate diverse prompts instead of copying subjects', async () => {
    const provider = new HeuristicRemixProvider();
    
    const descriptor: ImageDescriptor = {
      path: '/test/ultra-cinematic.jpg',
      hash: 'test123',
      width: 3840,
      height: 2160,
      palette: [],
      // Ultra-cinematic format with rich description
      subject: 'A lone figure standing in water at twilight, arms outstretched toward the glowing horizon',
      style: ['cinematic', 'atmospheric'],
      lighting: ['golden hour', 'backlighting']
    } as any;
    
    const context: RemixContext = {
      descriptors: [descriptor],
      options: {
        maxPerImage: 10,
        seed: 42,
        maxStyleAdj: 3,
        maxLighting: 2
      }
    };
    
    const result = await provider.generatePrompts(context);
    
    // Check that we got the right number of prompts
    expect(result.prompts).toHaveLength(10);
    
    // Collect all generated subject portions
    const subjects = result.prompts.map(p => {
      // Extract the subject part (before style/lighting additions)
      const withoutPrefix = p.prompt.replace(/^Use reference images.*?\n\n/, '');
      const parts = withoutPrefix.split(';');
      return parts[0].trim();
    });
    
    // Check that subjects are varied (not all the same)
    const uniqueSubjects = new Set(subjects);
    expect(uniqueSubjects.size).toBeGreaterThan(5); // Should have variety
    
    // Check that no subject is the exact original
    const originalSubject = 'A lone figure standing in water at twilight, arms outstretched toward the glowing horizon';
    subjects.forEach(subject => {
      expect(subject).not.toBe(originalSubject);
    });
    
    // Check Jaccard similarity between prompts
    for (let i = 0; i < result.prompts.length - 1; i++) {
      for (let j = i + 1; j < result.prompts.length; j++) {
        const similarity = jaccardSimilarity(
          result.prompts[i].prompt,
          result.prompts[j].prompt
        );
        // Prompts should be different enough
        expect(similarity).toBeLessThan(0.8);
      }
    }
    
    // Check that tags reflect semantic components
    result.prompts.forEach(prompt => {
      const hasEntityTag = prompt.tags.some(t => t.startsWith('entity:'));
      const hasActionTag = prompt.tags.some(t => t.startsWith('action:'));
      const hasSettingTag = prompt.tags.some(t => t.startsWith('setting:'));
      
      expect(hasEntityTag).toBe(true);
      expect(hasActionTag).toBe(true);
      expect(hasSettingTag).toBe(true);
    });
  });
  
  it('should maintain deterministic behavior with same seed', async () => {
    const provider = new HeuristicRemixProvider();
    
    const descriptor: ImageDescriptor = {
      path: '/test/deterministic.jpg',
      hash: 'det456',
      width: 1920,
      height: 1080,
      palette: [],
      subject: 'A person walking on the beach at sunset',
      style: ['peaceful'],
      lighting: ['golden hour']
    } as any;
    
    const context1: RemixContext = {
      descriptors: [descriptor],
      options: {
        maxPerImage: 5,
        seed: 999,
        maxStyleAdj: 3,
        maxLighting: 2
      }
    };
    
    const context2: RemixContext = {
      descriptors: [descriptor],
      options: {
        maxPerImage: 5,
        seed: 999,
        maxStyleAdj: 3,
        maxLighting: 2
      }
    };
    
    const result1 = await provider.generatePrompts(context1);
    const result2 = await provider.generatePrompts(context2);
    
    // Should generate identical prompts with same seed
    expect(result1.prompts).toEqual(result2.prompts);
  });
});