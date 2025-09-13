import type { RemixProvider, RemixContext, RemixResult } from './types.js';
import type { ImageDescriptor, PromptRow } from '../../../types.js';
import { createOperationLogger, logTiming } from '../../../logger.js';
import { generateIdempotencyKey } from '../../idempotency.js';
import { extractComponents, simplifyDescription } from '../semantic/extractor.js';
import { generateFromTemplate } from '../semantic/templates.js';

/**
 * Style-only instruction - MUST be preserved verbatim
 */
export const STYLE_ONLY_PREFIX = 
  'Use reference images strictly for style, palette, texture, and mood. ' +
  'Do NOT copy subject geometry, pose, or layout. ' +
  'Prioritize user text for subject and composition.';

/**
 * Mulberry32 seeded RNG (better distribution than LCG)
 */
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  choice<T>(array: T[]): T {
    if (array.length === 0) throw new Error('Cannot choose from empty array');
    return array[Math.floor(this.next() * array.length)]!;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
}

/**
 * Style adjectives for variation
 */
const STYLE_ADJECTIVES = [
  'vibrant', 'muted', 'saturated', 'desaturated', 'bold', 'subtle',
  'warm', 'cool', 'rich', 'pale', 'deep', 'light', 'dark', 'bright',
  'soft', 'harsh', 'smooth', 'textured', 'clean', 'weathered'
];

/**
 * Lighting variations
 */
const LIGHTING_TERMS = [
  'natural light', 'soft light', 'hard light', 'dramatic light',
  'golden hour', 'blue hour', 'overcast', 'studio lighting',
  'backlighting', 'side lighting', 'rim lighting', 'diffused light'
];

/**
 * Composition directives
 */
const COMPOSITION_DIRECTIVES = [
  'wide shot', 'close-up', 'medium shot', 'low angle', 'high angle',
  'centered', 'rule of thirds', 'leading lines', 'symmetrical', 'dynamic'
];

/**
 * Heuristic-based remix provider
 * 
 * This is the original implementation that maintains backward compatibility.
 * NOTE: Currently copies subjects verbatim - will be improved in PR-REMIX-HEUR-02
 */
export class HeuristicRemixProvider implements RemixProvider {
  readonly name = 'heuristic';
  readonly version = '1.0.0';
  
  private log = createOperationLogger('HeuristicRemixProvider');

  /**
   * Generate controlled variations of style adjectives
   */
  private varyStyleAdjectives(
    original: string[],
    rng: SeededRNG,
    maxCount: number
  ): string[] {
    const available = [...STYLE_ADJECTIVES];
    const result = [...original.slice(0, maxCount)];
    
    // Add random adjectives up to max
    while (result.length < maxCount && available.length > 0) {
      const choice = rng.choice(available);
      if (!result.includes(choice)) {
        result.push(choice);
        available.splice(available.indexOf(choice), 1);
      }
    }
    
    return result.slice(0, maxCount);
  }

  /**
   * Generate controlled variations of lighting terms
   */
  private varyLighting(
    original: string[],
    rng: SeededRNG,
    maxCount: number
  ): string[] {
    const available = [...LIGHTING_TERMS];
    const result = [...original.slice(0, maxCount)];
    
    // Add random lighting up to max
    while (result.length < maxCount && available.length > 0) {
      const choice = rng.choice(available);
      if (!result.includes(choice)) {
        result.push(choice);
        available.splice(available.indexOf(choice), 1);
      }
    }
    
    return result.slice(0, maxCount);
  }


  /**
   * Inject style-only prefix into prompt
   */
  private injectStyleOnlyPrefix(prompt: string): string {
    return `${STYLE_ONLY_PREFIX}\n\n${prompt}`;
  }

  /**
   * Generate prompt variations from a single descriptor
   */
  private generatePromptsForDescriptor(
    descriptor: ImageDescriptor,
    options: RemixContext['options'],
    rng: SeededRNG
  ): PromptRow[] {
    const prompts: PromptRow[] = [];
    const usedPrompts = new Set<string>();
    
    // Get the subject description (ultra-cinematic or standard format)
    const subjectText = (descriptor as any).subject || 
                       (descriptor.subjects && descriptor.subjects.join(', ')) || 
                       'abstract subject';
    
    // NEW: Extract semantic components instead of using subjects verbatim
    const simplified = simplifyDescription(subjectText);
    const components = extractComponents(simplified);
    
    // Handle lighting as either array (standard) or object (ultra-cinematic)
    let lightingArray: string[] = [];
    if (Array.isArray(descriptor.lighting)) {
      lightingArray = descriptor.lighting;
    } else if (typeof descriptor.lighting === 'object' && descriptor.lighting !== null) {
      const lightingObj = descriptor.lighting as any;
      if (lightingObj.quality) lightingArray.push(lightingObj.quality);
      if (lightingObj.timeOfDay) lightingArray.push(lightingObj.timeOfDay);
      if (lightingObj.direction) lightingArray.push(lightingObj.direction);
    } else if (typeof descriptor.lighting === 'string') {
      lightingArray = [descriptor.lighting];
    }
    
    // Ensure style is an array
    const styleArray = Array.isArray(descriptor.style) ? descriptor.style : [];
    
    for (let i = 0; i < options.maxPerImage; i++) {
      // NEW: Generate semantically varied subject using templates
      const variedSubject = generateFromTemplate(components, rng, usedPrompts);
      usedPrompts.add(variedSubject);
      
      // Generate style and lighting variations
      const styleAdj = this.varyStyleAdjectives(styleArray, rng, options.maxStyleAdj);
      const lighting = this.varyLighting(lightingArray, rng, options.maxLighting);
      const composition = rng.choice(COMPOSITION_DIRECTIVES);
      
      // Compose prompt with varied subject
      const basePrompt = this.composeVariedPrompt(
        variedSubject,
        styleAdj,
        lighting,
        descriptor.camera,
        composition
      );
      
      // Add style-only prefix
      const finalPrompt = this.injectStyleOnlyPrefix(basePrompt);
      
      // Create tags with semantic components
      const tags = [
        ...components.entities.map(e => `entity:${e}`),
        ...components.actions.map(a => `action:${a}`),
        ...components.settings.map(s => `setting:${s}`),
        ...styleAdj.map(s => `style:${s}`),
        ...lighting.map(l => `lighting:${l.replace(' ', '-')}`),
        `composition:${composition.replace(' ', '-')}`,
        `source:${descriptor.path}`,
      ];
      
      prompts.push({
        prompt: finalPrompt,
        sourceImage: descriptor.path,
        tags,
        seed: options.seed + i,
      });
    }
    
    return prompts;
  }

  /**
   * Compose a prompt with the varied subject
   */
  private composeVariedPrompt(
    variedSubject: string,
    styleAdj: string[],
    lighting: string[],
    camera?: { lens?: string; f?: number },
    composition?: string
  ): string {
    const parts: string[] = [];
    
    // Start with the varied subject (already contains entities, actions, settings)
    parts.push(variedSubject);
    
    // Add style adjectives if not already in subject
    if (styleAdj.length > 0 && !variedSubject.includes('style')) {
      parts.push(`${styleAdj.slice(0, 3).join(', ')} style`);
    }
    
    // Add lighting if not already in subject
    if (lighting.length > 0 && !variedSubject.includes('light')) {
      parts.push(`lighting: ${lighting.slice(0, 2).join(', ')}`);
    }
    
    // Camera (optional)
    if (camera?.lens) {
      parts.push(`lens: ${camera.lens}`);
    }
    if (camera?.f) {
      parts.push(`f/${camera.f}`);
    }
    
    // Composition (optional) if not already in subject
    if (composition && !variedSubject.includes(composition)) {
      parts.push(`composition: ${composition}`);
    }
    
    return parts.join('; ');
  }

  async generatePrompts(context: RemixContext): Promise<RemixResult> {
    const { descriptors, options } = context;
    
    this.log.info({
      descriptors: descriptors.length,
      maxPerImage: options.maxPerImage,
      seed: options.seed,
    }, 'Starting prompt generation');
    
    const startTime = Date.now();
    const rng = new SeededRNG(options.seed);
    const allPrompts: PromptRow[] = [];
    
    for (const descriptor of descriptors) {
      if (descriptor.errors && descriptor.errors.length > 0) {
        this.log.warn({ path: descriptor.path, errors: descriptor.errors }, 
                  'Skipping descriptor with errors');
        continue;
      }
      
      try {
        const prompts = this.generatePromptsForDescriptor(descriptor, options, rng);
        allPrompts.push(...prompts);
      } catch (error) {
        this.log.error({ path: descriptor.path, error }, 
                   'Failed to generate prompts for descriptor');
      }
    }
    
    // Add idempotency keys
    for (const prompt of allPrompts) {
      const key = generateIdempotencyKey(prompt.prompt, prompt.sourceImage);
      // Store idempotency key in _meta as any since it's not in the schema
      prompt._meta = { 
        ...prompt._meta,
        idempotencyKey: key,
      } as any;
    }
    
    logTiming(this.log, 'generatePrompts', startTime);
    
    const avgPerImage = Math.round(allPrompts.length / descriptors.length * 100) / 100;
    
    this.log.info({ 
      generated: allPrompts.length,
      avgPerImage 
    }, 'Prompt generation complete');
    
    return {
      prompts: allPrompts,
      metadata: {
        provider: this.name,
        version: this.version,
        avgPerImage,
        totalGenerated: allPrompts.length
      }
    };
  }

  isConfigured(): boolean {
    // Heuristic provider doesn't require external configuration
    return true;
  }
}