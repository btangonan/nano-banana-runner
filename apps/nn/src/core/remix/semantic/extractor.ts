/**
 * Semantic extraction module for parsing rich text descriptions
 * into structured components for remixing
 */

/**
 * Extracted semantic components from a description
 */
export interface SemanticComponents {
  entities: string[];      // People, animals, objects
  actions: string[];       // Verbs, activities
  settings: string[];      // Locations, environments
  descriptors: string[];   // Adjectives, modifiers
  times: string[];         // Temporal references
  raw: string;            // Original text
}

/**
 * Common entity patterns
 */
const ENTITY_PATTERNS = [
  /\b(person|people|man|woman|child|children|figure|figures|individual|individuals|silhouette|silhouettes)\b/gi,
  /\b(dog|cat|bird|animal|creature)\b/gi,
  /\b(car|vehicle|building|tree|object)\b/gi,
];

/**
 * Common action patterns (verbs)
 */
const ACTION_PATTERNS = [
  /\b(standing|sitting|walking|running|lying|laying)\b/gi,
  /\b(looking|gazing|watching|observing|staring)\b/gi,
  /\b(holding|carrying|grasping|reaching|touching)\b/gi,
  /\b(floating|flying|swimming|diving|jumping)\b/gi,
  /\b(playing|dancing|working|reading|writing)\b/gi,
  /\b(talking|speaking|chatting|conversing|discussing)\b/gi,
];

/**
 * Common setting patterns (locations)
 */
const SETTING_PATTERNS = [
  /\b(?:in|at|on|near|by|beside|under|over|through)\s+(?:the\s+)?(\w+)/gi,
  /\b(water|ocean|sea|beach|shore|lake|river|pool)\b/gi,
  /\b(mountain|hill|valley|forest|woods|field|meadow)\b/gi,
  /\b(city|street|building|house|room|park)\b/gi,
  /\b(sky|clouds|horizon|ground|earth)\b/gi,
];

/**
 * Common time patterns
 */
const TIME_PATTERNS = [
  /\b(twilight|dawn|dusk|sunset|sunrise|golden\s+hour|magic\s+hour)\b/gi,
  /\b(morning|afternoon|evening|night|nighttime|daytime)\b/gi,
  /\b(spring|summer|autumn|fall|winter)\b/gi,
];

/**
 * Common descriptor patterns (adjectives)
 */
const DESCRIPTOR_PATTERNS = [
  /\b(lone|solitary|single|alone|isolated)\b/gi,
  /\b(multiple|several|many|few|numerous)\b/gi,
  /\b(large|big|huge|small|tiny|massive)\b/gi,
  /\b(bright|dark|dim|luminous|shadowy)\b/gi,
  /\b(peaceful|serene|dramatic|mysterious|ethereal)\b/gi,
  /\b(beautiful|elegant|simple|complex|abstract)\b/gi,
];

/**
 * Extract semantic components from a text description
 */
export function extractComponents(description: string): SemanticComponents {
  // Sanitize and normalize input
  const normalized = description
    .replace(/[^\w\s,.!?-]/g, ' ')  // Remove special chars except punctuation
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
  
  // If empty, return defaults
  if (!normalized) {
    return {
      entities: ['subject'],
      actions: ['existing'],
      settings: ['environment'],
      descriptors: ['abstract'],
      times: [],
      raw: description,
    };
  }
  
  // Extract components using patterns
  const components: SemanticComponents = {
    entities: extractMatches(normalized, ENTITY_PATTERNS),
    actions: extractMatches(normalized, ACTION_PATTERNS),
    settings: extractSettings(normalized),
    descriptors: extractMatches(normalized, DESCRIPTOR_PATTERNS),
    times: extractMatches(normalized, TIME_PATTERNS),
    raw: description,
  };
  
  // Ensure we have at least one of each required component
  if (components.entities.length === 0) {
    components.entities = ['subject'];
  }
  if (components.actions.length === 0) {
    components.actions = ['positioned'];
  }
  if (components.settings.length === 0) {
    components.settings = ['scene'];
  }
  
  return components;
}

/**
 * Extract matches from text using multiple patterns
 */
function extractMatches(text: string, patterns: RegExp[]): string[] {
  const matches = new Set<string>();
  
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Use the first capturing group if present, otherwise the full match
      const extracted = match[1] || match[0];
      if (extracted && extracted.length > 1) {
        matches.add(extracted.toLowerCase());
      }
    }
  }
  
  return Array.from(matches);
}

/**
 * Special extraction for settings (handles preposition + noun)
 */
function extractSettings(text: string): string[] {
  const settings = new Set<string>();
  
  // Extract prepositional phrases
  const prepPattern = /\b(?:in|at|on|near|by|beside|under|over|through|across|along|within)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/gi;
  let match;
  while ((match = prepPattern.exec(text)) !== null) {
    if (match[1] && match[1].length > 2) {
      settings.add(match[1].toLowerCase());
    }
  }
  
  // Also extract standalone location words
  const locationWords = extractMatches(text, SETTING_PATTERNS.slice(1));
  locationWords.forEach(word => settings.add(word));
  
  return Array.from(settings);
}

/**
 * Split complex descriptions into simpler components
 * Handles multi-sentence descriptions by focusing on the first sentence
 */
export function simplifyDescription(description: string): string {
  // Take only the first sentence or clause
  const firstSentence = description
    .split(/[.!?;]/)
    .filter(s => s.trim().length > 0)[0];
  
  if (!firstSentence) {
    return description;
  }
  
  // Remove parenthetical information
  const simplified = firstSentence
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();
  
  return simplified || description;
}

/**
 * Check if a word is a stop word that shouldn't be varied
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'of', 'to', 'and', 'or', 'but', 'for', 'with', 'as', 'if',
  'this', 'that', 'these', 'those', 'it', 'its'
]);

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase());
}

/**
 * Extract keywords from text for variation
 * Returns only content words, not stop words
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter(word => word.length > 2)
    .filter(word => !isStopWord(word));
  
  // Deduplicate while preserving order
  return [...new Set(words)];
}