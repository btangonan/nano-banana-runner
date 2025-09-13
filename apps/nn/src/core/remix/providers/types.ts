import type { ImageDescriptor, PromptRow } from '../../../types.js';

/**
 * Options for remix operations
 */
export interface RemixOptions {
  maxPerImage: number;      // Max prompts per image (default: 50, max: 100)
  seed: number;             // Deterministic seed
  maxStyleAdj: number;      // Max style adjectives (default: 3)
  maxLighting: number;      // Max lighting terms (default: 2)
}

/**
 * Context provided to remix providers
 */
export interface RemixContext {
  descriptors: ImageDescriptor[];
  options: RemixOptions;
}

/**
 * Result from a remix operation
 */
export interface RemixResult {
  prompts: PromptRow[];
  metadata?: {
    provider: string;
    version: string;
    avgPerImage: number;
    totalGenerated: number;
  };
}

/**
 * Interface for remix providers
 * 
 * Implementations can use different strategies:
 * - Heuristic: Rule-based semantic extraction
 * - LLM: Language model-based remixing
 * - Template: Pattern-based generation
 */
export interface RemixProvider {
  /**
   * Provider identifier
   */
  readonly name: string;
  
  /**
   * Provider version for compatibility tracking
   */
  readonly version: string;
  
  /**
   * Generate prompts from image descriptors
   * 
   * @param context - Descriptors and options for remixing
   * @returns Generated prompts with metadata
   */
  generatePrompts(context: RemixContext): Promise<RemixResult>;
  
  /**
   * Validate provider configuration
   * 
   * @returns true if provider is properly configured
   */
  isConfigured(): boolean;
}

/**
 * Factory for creating remix providers
 */
export interface RemixProviderFactory {
  create(type: 'heuristic' | 'llm' | 'template'): RemixProvider;
}