/**
 * Synonym dictionaries for semantic variation in prompt generation
 * 
 * These dictionaries provide alternative words for entities, actions, 
 * settings, and descriptors to create varied prompts while maintaining
 * semantic meaning.
 */

/**
 * Entity synonyms - alternative words for people/subjects
 */
export const ENTITY_SYNONYMS: Record<string, string[]> = {
  // People
  'person': ['individual', 'figure', 'silhouette', 'character', 'subject', 'being'],
  'people': ['individuals', 'figures', 'group', 'crowd', 'gathering', 'subjects'],
  'man': ['gentleman', 'male figure', 'male', 'guy', 'fellow'],
  'woman': ['lady', 'female figure', 'female', 'girl'],
  'child': ['kid', 'youth', 'youngster', 'minor'],
  'figure': ['silhouette', 'form', 'shape', 'presence', 'individual'],
  
  // Animals
  'dog': ['canine', 'hound', 'pup', 'doggo'],
  'cat': ['feline', 'kitty', 'kitten'],
  'bird': ['avian', 'fowl', 'winged creature'],
  
  // Objects
  'car': ['vehicle', 'automobile', 'auto', 'ride'],
  'tree': ['foliage', 'timber', 'wood', 'forest element'],
  'building': ['structure', 'edifice', 'construction', 'architecture'],
};

/**
 * Action synonyms - alternative words for verbs/activities
 */
export const ACTION_SYNONYMS: Record<string, string[]> = {
  // Movement
  'standing': ['positioned', 'poised', 'situated', 'placed', 'stationed'],
  'walking': ['strolling', 'moving', 'wandering', 'ambulating', 'traversing'],
  'running': ['sprinting', 'jogging', 'racing', 'dashing', 'rushing'],
  'sitting': ['seated', 'resting', 'perched', 'settled'],
  'lying': ['reclining', 'resting', 'sprawled', 'horizontal'],
  
  // Interaction
  'looking': ['gazing', 'viewing', 'observing', 'watching', 'peering'],
  'holding': ['grasping', 'carrying', 'clutching', 'gripping'],
  'reaching': ['extending', 'stretching', 'grasping for'],
  
  // State
  'floating': ['drifting', 'hovering', 'suspended', 'buoyant'],
  'glowing': ['radiating', 'shining', 'illuminated', 'luminous'],
};

/**
 * Setting synonyms - alternative words for locations/environments
 */
export const SETTING_SYNONYMS: Record<string, string[]> = {
  // Water
  'water': ['ocean', 'sea', 'lake', 'waves', 'aquatic environment'],
  'ocean': ['sea', 'waters', 'marine environment', 'deep blue'],
  'beach': ['shore', 'coastline', 'sand', 'seaside', 'waterfront'],
  'river': ['stream', 'waterway', 'creek', 'flowing water'],
  
  // Land
  'mountain': ['peak', 'summit', 'hill', 'elevation', 'highland'],
  'forest': ['woods', 'woodland', 'trees', 'grove', 'timberland'],
  'field': ['meadow', 'grassland', 'pasture', 'plain', 'prairie'],
  'desert': ['arid land', 'dunes', 'wasteland', 'dry landscape'],
  
  // Urban
  'city': ['urban area', 'metropolis', 'downtown', 'cityscape'],
  'street': ['road', 'avenue', 'pathway', 'boulevard', 'lane'],
  'building': ['structure', 'architecture', 'edifice', 'construction'],
  
  // Sky
  'sky': ['heavens', 'atmosphere', 'firmament', 'overhead'],
  'clouds': ['cloudscape', 'cumulus', 'overcast', 'sky formations'],
};

/**
 * Time synonyms - alternative words for temporal descriptions
 */
export const TIME_SYNONYMS: Record<string, string[]> = {
  'twilight': ['dusk', 'sunset', 'golden hour', 'evening light', 'magic hour'],
  'dawn': ['sunrise', 'daybreak', 'first light', 'morning', 'early hours'],
  'night': ['nighttime', 'evening', 'darkness', 'nocturnal', 'after dark'],
  'day': ['daytime', 'daylight', 'afternoon', 'midday'],
  'morning': ['a.m.', 'early day', 'forenoon', 'dawn'],
  'evening': ['p.m.', 'eventide', 'late day', 'dusk'],
};

/**
 * Descriptor synonyms - alternative adjectives
 */
export const DESCRIPTOR_SYNONYMS: Record<string, string[]> = {
  // Quantity
  'lone': ['solitary', 'single', 'isolated', 'solo', 'individual'],
  'multiple': ['several', 'various', 'numerous', 'many'],
  
  // Size
  'large': ['big', 'huge', 'massive', 'grand', 'substantial'],
  'small': ['tiny', 'little', 'petite', 'compact', 'mini'],
  
  // Mood
  'peaceful': ['serene', 'calm', 'tranquil', 'quiet', 'still'],
  'dramatic': ['striking', 'bold', 'intense', 'powerful', 'dynamic'],
  'mysterious': ['enigmatic', 'cryptic', 'mystical', 'secretive'],
  
  // Visual
  'bright': ['luminous', 'radiant', 'brilliant', 'vivid', 'gleaming'],
  'dark': ['shadowy', 'dim', 'obscure', 'murky', 'dusky'],
  'colorful': ['vibrant', 'vivid', 'chromatic', 'multicolored'],
};

/**
 * Get a synonym for a word, or return the original if no synonyms exist
 */
export function getSynonym(word: string, index: number = 0): string {
  const normalizedWord = word.toLowerCase();
  
  // Check all synonym dictionaries
  const allSynonyms = {
    ...ENTITY_SYNONYMS,
    ...ACTION_SYNONYMS,
    ...SETTING_SYNONYMS,
    ...TIME_SYNONYMS,
    ...DESCRIPTOR_SYNONYMS,
  };
  
  if (allSynonyms[normalizedWord]) {
    const synonyms = allSynonyms[normalizedWord];
    return synonyms[index % synonyms.length] || word;
  }
  
  return word;
}

/**
 * Get all available synonyms for a word
 */
export function getAllSynonyms(word: string): string[] {
  const normalizedWord = word.toLowerCase();
  
  const allSynonyms = {
    ...ENTITY_SYNONYMS,
    ...ACTION_SYNONYMS,
    ...SETTING_SYNONYMS,
    ...TIME_SYNONYMS,
    ...DESCRIPTOR_SYNONYMS,
  };
  
  return allSynonyms[normalizedWord] || [word];
}