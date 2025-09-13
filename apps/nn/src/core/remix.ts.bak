import type { ImageDescriptor, PromptRow } from '../types.js';
import { createOperationLogger, logTiming } from '../logger.js';
import { generateIdempotencyKey } from './idempotency.js';

/**
 * Style-only instruction - MUST be preserved verbatim
 */
export const STYLE_ONLY_PREFIX = 
  'Use reference images strictly for style, palette, texture, and mood. ' +
  'Do NOT copy subject geometry, pose, or layout. ' +
  'Prioritize user text for subject and composition.';

/**
 * Remix options for prompt generation
 */
export interface RemixOptions {
  maxPerImage: number;      // Max prompts per image (default: 50, max: 100)
  seed: number;             // Deterministic seed
  maxStyleAdj: number;      // Max style adjectives (default: 3)
  maxLighting: number;      // Max lighting terms (default: 2)
}

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
 * Generate controlled variations of style adjectives
 */
function varyStyleAdjectives(
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
function varyLighting(
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
 * Compose final prompt from components
 */
export function composePrompt(
  subjects: string[],
  styleAdj: string[],
  lighting: string[],
  camera?: { lens?: string; f?: number },
  composition?: string
): string {
  const parts: string[] = [];
  
  // Subject (required)
  if (subjects.length > 0) {
    parts.push(subjects.join(', '));
  } else {
    parts.push('subject');
  }
  
  // Style adjectives (≤3)
  if (styleAdj.length > 0) {
    parts.push(`${styleAdj.slice(0, 3).join(', ')} style`);
  }
  
  // Lighting (≤2) 
  if (lighting.length > 0) {
    parts.push(`lighting: ${lighting.slice(0, 2).join(', ')}`);
  }
  
  // Camera (optional)
  if (camera?.lens) {
    parts.push(`lens: ${camera.lens}`);
  }
  if (camera?.f) {
    parts.push(`f/${camera.f}`);
  }
  
  // Composition (optional)
  if (composition) {
    parts.push(`composition: ${composition}`);
  }
  
  return parts.join('; ');
}

/**
 * Inject style-only prefix into prompt
 */
export function injectStyleOnlyPrefix(prompt: string): string {
  return `${STYLE_ONLY_PREFIX}\n\n${prompt}`;
}

/**
 * Generate prompt variations from a single descriptor
 */
function generatePromptsForDescriptor(
  descriptor: ImageDescriptor,
  options: RemixOptions,
  rng: SeededRNG
): PromptRow[] {
  const prompts: PromptRow[] = [];
  
  // Handle both ultra-cinematic (singular subject) and standard (plural subjects) formats
  const subjects = descriptor.subjects || (descriptor.subject ? [descriptor.subject] : []);
  
  // Handle lighting as either array (standard) or object (ultra-cinematic)
  let lightingArray: string[] = [];
  if (Array.isArray(descriptor.lighting)) {
    lightingArray = descriptor.lighting;
  } else if (typeof descriptor.lighting === 'object' && descriptor.lighting !== null) {
    // Extract lighting terms from ultra-cinematic object
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
    // Generate variations
    const styleAdj = varyStyleAdjectives(styleArray, rng, options.maxStyleAdj);
    const lighting = varyLighting(lightingArray, rng, options.maxLighting);
    const composition = rng.choice(COMPOSITION_DIRECTIVES);
    
    // Compose prompt
    const basePrompt = composePrompt(
      subjects,
      styleAdj,
      lighting,
      descriptor.camera,
      composition
    );
    
    // Add style-only prefix
    const finalPrompt = injectStyleOnlyPrefix(basePrompt);
    
    // Create tags with provenance
    const tags = [
      ...subjects.map(s => `subject:${s}`),
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
 * Generate prompts from multiple image descriptors
 */
export function generatePrompts(
  descriptors: ImageDescriptor[],
  options: RemixOptions
): PromptRow[] {
  const log = createOperationLogger('generatePrompts', {
    descriptors: descriptors.length,
    maxPerImage: options.maxPerImage,
    seed: options.seed,
  });
  
  const startTime = Date.now();
  const rng = new SeededRNG(options.seed);
  const allPrompts: PromptRow[] = [];
  
  for (const descriptor of descriptors) {
    if (descriptor.errors && descriptor.errors.length > 0) {
      log.warn({ path: descriptor.path, errors: descriptor.errors }, 
                'Skipping descriptor with errors');
      continue;
    }
    
    try {
      const prompts = generatePromptsForDescriptor(descriptor, options, rng);
      allPrompts.push(...prompts);
    } catch (error) {
      log.error({ path: descriptor.path, error }, 
                 'Failed to generate prompts for descriptor');
    }
  }
  
  // Add idempotency keys
  for (const prompt of allPrompts) {
    const key = generateIdempotencyKey(prompt.prompt, prompt.sourceImage);
    prompt._meta = { 
      ...prompt._meta,
      idempotencyKey: key,
    };
  }
  
  logTiming(log, 'generatePrompts', startTime);
  log.info({ 
    generated: allPrompts.length,
    avgPerImage: Math.round(allPrompts.length / descriptors.length * 100) / 100 
  }, 'Prompt generation complete');
  
  return allPrompts;
}