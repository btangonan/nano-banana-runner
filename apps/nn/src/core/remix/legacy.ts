/**
 * Legacy exports for backward compatibility
 * These functions are maintained to avoid breaking existing code
 * New code should use the RemixProvider interface instead
 */

/**
 * Style-only instruction - MUST be preserved verbatim
 */
export const STYLE_ONLY_PREFIX = 
  'Use reference images strictly for style, palette, texture, and mood. ' +
  'Do NOT copy subject geometry, pose, or layout. ' +
  'Prioritize user text for subject and composition.';

/**
 * Compose final prompt from components
 * 
 * @deprecated Use RemixProvider.generatePrompts instead
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
 * 
 * @deprecated Use RemixProvider.generatePrompts instead
 */
export function injectStyleOnlyPrefix(prompt: string): string {
  return `${STYLE_ONLY_PREFIX}\n\n${prompt}`;
}