/**
 * Template-based prompt generation using semantic components
 */

import type { SemanticComponents } from './extractor.js';
import { getAllSynonyms } from './synonyms.js';

/**
 * Seeded random number generator for deterministic variation
 */
export interface RNG {
  next(): number;
  choice<T>(array: T[]): T;
}

/**
 * Prompt template structure
 */
export interface PromptTemplate {
  pattern: string;
  requiresEntity: boolean;
  requiresAction: boolean;
  requiresSetting: boolean;
}

/**
 * Available prompt templates with different structures
 */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // Basic templates
  { pattern: '[DESCRIPTOR] [ENTITY] [ACTION] [SETTING] [TIME]', requiresEntity: true, requiresAction: true, requiresSetting: true },
  { pattern: '[ENTITY] [ACTION] [SETTING] during [TIME]', requiresEntity: true, requiresAction: true, requiresSetting: true },
  { pattern: '[DESCRIPTOR] [ENTITY] [SETTING], [ACTION]', requiresEntity: true, requiresAction: true, requiresSetting: true },
  
  // Inverted templates
  { pattern: '[SETTING] with [DESCRIPTOR] [ENTITY] [ACTION]', requiresEntity: true, requiresAction: true, requiresSetting: true },
  { pattern: '[TIME]: [ENTITY] [ACTION] [SETTING]', requiresEntity: true, requiresAction: true, requiresSetting: true },
  
  // Minimal templates
  { pattern: '[ENTITY] [ACTION]', requiresEntity: true, requiresAction: true, requiresSetting: false },
  { pattern: '[DESCRIPTOR] [ENTITY] [SETTING]', requiresEntity: true, requiresAction: false, requiresSetting: true },
  
  // Atmospheric templates
  { pattern: '[TIME] atmosphere with [ENTITY] [SETTING]', requiresEntity: true, requiresAction: false, requiresSetting: true },
  { pattern: '[DESCRIPTOR] scene: [ENTITY] [ACTION]', requiresEntity: true, requiresAction: true, requiresSetting: false },
];

/**
 * Generate a varied prompt from semantic components using templates
 */
export function generateFromTemplate(
  components: SemanticComponents,
  rng: RNG,
  usedPrompts: Set<string> = new Set()
): string {
  // Select a random template
  const template = rng.choice(PROMPT_TEMPLATES);
  
  // Try to generate a unique prompt (up to 10 attempts)
  for (let attempt = 0; attempt < 10; attempt++) {
    const prompt = fillTemplate(template, components, rng, attempt);
    
    // Check if this prompt is too similar to existing ones
    if (!isTooSimilar(prompt, usedPrompts)) {
      return prompt;
    }
  }
  
  // Fallback: return a basic variation
  return generateBasicPrompt(components, rng);
}

/**
 * Fill a template with varied components
 */
function fillTemplate(
  template: PromptTemplate,
  components: SemanticComponents,
  rng: RNG,
  variationIndex: number
): string {
  let prompt = template.pattern;
  
  // Replace entity
  if (template.requiresEntity && components.entities.length > 0) {
    const entity = rng.choice(components.entities);
    const variedEntity = varyWord(entity, rng, variationIndex);
    prompt = prompt.replace('[ENTITY]', variedEntity);
  } else {
    prompt = prompt.replace('[ENTITY]', 'subject');
  }
  
  // Replace action
  if (template.requiresAction && components.actions.length > 0) {
    const action = rng.choice(components.actions);
    const variedAction = varyWord(action, rng, variationIndex);
    prompt = prompt.replace('[ACTION]', variedAction);
  } else {
    prompt = prompt.replace('[ACTION]', 'positioned');
  }
  
  // Replace setting
  if (template.requiresSetting && components.settings.length > 0) {
    const setting = rng.choice(components.settings);
    const variedSetting = varyWord(setting, rng, variationIndex);
    prompt = prompt.replace('[SETTING]', variedSetting.startsWith('in ') ? variedSetting : `in ${variedSetting}`);
  } else {
    prompt = prompt.replace('[SETTING]', 'in the scene');
  }
  
  // Replace descriptor
  if (components.descriptors.length > 0) {
    const descriptor = rng.choice(components.descriptors);
    const variedDescriptor = varyWord(descriptor, rng, variationIndex);
    prompt = prompt.replace('[DESCRIPTOR]', variedDescriptor);
  } else {
    prompt = prompt.replace('[DESCRIPTOR] ', ''); // Remove if no descriptor
  }
  
  // Replace time
  if (components.times.length > 0) {
    const time = rng.choice(components.times);
    const variedTime = varyWord(time, rng, variationIndex);
    prompt = prompt.replace('[TIME]', variedTime);
  } else {
    prompt = prompt.replace(' [TIME]', ''); // Remove if no time
    prompt = prompt.replace('[TIME]', ''); // Remove if no time
  }
  
  // Clean up extra spaces
  return prompt.replace(/\s+/g, ' ').trim();
}

/**
 * Vary a word using synonyms
 */
function varyWord(word: string, rng: RNG, variationIndex: number): string {
  const synonyms = getAllSynonyms(word);
  
  // Use variation index to ensure different synonym selection
  if (synonyms.length > 1) {
    // Combine RNG with variation index for more variety
    const index = Math.floor(rng.next() * synonyms.length + variationIndex) % synonyms.length;
    return synonyms[index] || word;
  }
  
  return word;
}

/**
 * Generate a basic prompt when template generation fails
 */
function generateBasicPrompt(components: SemanticComponents, rng: RNG): string {
  const parts: string[] = [];
  
  if (components.descriptors.length > 0) {
    parts.push(rng.choice(components.descriptors));
  }
  
  if (components.entities.length > 0) {
    parts.push(rng.choice(components.entities));
  } else {
    parts.push('subject');
  }
  
  if (components.actions.length > 0) {
    parts.push(rng.choice(components.actions));
  }
  
  if (components.settings.length > 0) {
    const setting = rng.choice(components.settings);
    parts.push(setting.startsWith('in ') ? setting : `in ${setting}`);
  }
  
  if (components.times.length > 0) {
    parts.push(`at ${rng.choice(components.times)}`);
  }
  
  return parts.join(' ');
}

/**
 * Calculate Jaccard similarity between two prompts
 */
export function jaccardSimilarity(prompt1: string, prompt2: string): number {
  const words1 = new Set(prompt1.toLowerCase().split(/\s+/));
  const words2 = new Set(prompt2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Check if a prompt is too similar to existing ones
 */
function isTooSimilar(prompt: string, existingPrompts: Set<string>, threshold: number = 0.7): boolean {
  for (const existing of existingPrompts) {
    if (jaccardSimilarity(prompt, existing) > threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Create diverse variations from semantic components
 */
export function createVariations(
  components: SemanticComponents,
  rng: RNG,
  count: number = 5
): string[] {
  const variations: string[] = [];
  const usedPrompts = new Set<string>();
  
  for (let i = 0; i < count; i++) {
    const variation = generateFromTemplate(components, rng, usedPrompts);
    variations.push(variation);
    usedPrompts.add(variation);
  }
  
  return variations;
}