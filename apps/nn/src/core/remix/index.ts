import type { ImageDescriptor, PromptRow } from '../../types.js';
import type { RemixOptions, RemixProvider } from './providers/index.js';
import { HeuristicRemixProvider } from './providers/index.js';
import { createOperationLogger } from '../../logger.js';

// Re-export types and constants for backward compatibility
export type { RemixOptions } from './providers/index.js';
export { STYLE_ONLY_PREFIX } from './providers/heuristic.js';

// Re-export legacy functions for backward compatibility
export { composePrompt, injectStyleOnlyPrefix } from './legacy.js';

/**
 * Global provider instance - can be overridden for testing
 */
let globalProvider: RemixProvider | null = null;

/**
 * Get the current remix provider
 * Defaults to HeuristicRemixProvider if not set
 */
export function getRemixProvider(): RemixProvider {
  if (!globalProvider) {
    globalProvider = new HeuristicRemixProvider();
  }
  return globalProvider;
}

/**
 * Set a custom remix provider
 * Useful for testing or switching strategies
 */
export function setRemixProvider(provider: RemixProvider): void {
  globalProvider = provider;
}

/**
 * Generate prompts from multiple image descriptors
 * 
 * This is the main entry point that maintains backward compatibility
 * while delegating to the provider pattern internally.
 */
export async function generatePrompts(
  descriptors: ImageDescriptor[],
  options: RemixOptions
): Promise<PromptRow[]> {
  const log = createOperationLogger('generatePrompts');
  
  log.info({
    descriptors: descriptors.length,
    maxPerImage: options.maxPerImage,
    seed: options.seed,
  }, 'Delegating to remix provider');
  
  const provider = getRemixProvider();
  
  if (!provider.isConfigured()) {
    throw new Error(`Remix provider ${provider.name} is not properly configured`);
  }
  
  const result = await provider.generatePrompts({
    descriptors,
    options
  });
  
  log.info({
    provider: provider.name,
    version: provider.version,
    generated: result.prompts.length,
    avgPerImage: result.metadata?.avgPerImage
  }, 'Provider completed prompt generation');
  
  return result.prompts;
}