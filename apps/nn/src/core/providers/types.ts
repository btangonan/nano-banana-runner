import { z } from 'zod';

/**
 * Enhanced ImageDescriptor schema with additive fields for AI-powered analysis
 * Backward compatible with existing Sharp-based descriptors
 */
export const ImageDescriptorSchema = z.object({
  // Core fields (existing)
  path: z.string(),
  hash: z.string(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  format: z.string().optional(),
  palette: z.array(z.string()).max(10).optional(),
  
  // Provider identification
  provider: z.enum(['sharp', 'gemini']),
  
  // AI-enhanced fields (additive, optional)
  objects: z.array(z.string()).max(20).optional(),
  scene: z.string().max(256).optional(),
  style: z.array(z.string()).max(10).optional(),
  composition: z.string().max(256).optional(),
  colors: z.array(z.string()).max(10).optional(), // hex or named colors
  lighting: z.string().max(256).optional(),
  qualityIssues: z.array(z.string()).optional(),
  safetyTags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  
  // Legacy fields (for backward compatibility)
  subjects: z.array(z.string()).optional(),
  camera: z.object({
    lens: z.string().optional(),
    f: z.number().positive().optional(),
  }).optional(),
  errors: z.array(z.string()).optional(),
}).strict();

export type ImageDescriptor = z.infer<typeof ImageDescriptorSchema>;

/**
 * Provider configuration for cost estimation
 */
export const ProviderConfigSchema = z.object({
  maxImagesPerBatch: z.number().int().positive().default(64),
  timeoutMs: z.number().int().positive().default(30000),
  retries: z.number().int().min(0).max(5).default(3),
  backoffMs: z.array(z.number().int().positive()).default([200, 400, 800]),
  costPerImage: z.number().min(0).default(0),
}).strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Cost estimation result
 */
export const CostEstimateSchema = z.object({
  imageCount: z.number().int().min(0),
  estimatedCost: z.number().min(0),
  estimatedTimeMs: z.number().int().min(0),
  provider: z.enum(['sharp', 'gemini']),
}).strict();

export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/**
 * Analyze provider interface
 * Supports both synchronous (Sharp) and asynchronous (Gemini) analysis
 */
export interface AnalyzeProvider {
  readonly name: 'sharp' | 'gemini';
  readonly config: ProviderConfig;
  
  /**
   * Analyze a single image and return descriptor
   * @param path - Image file path
   * @param buffer - Image buffer
   * @returns Promise resolving to ImageDescriptor
   */
  analyze(path: string, buffer: Buffer): Promise<ImageDescriptor>;
  
  /**
   * Batch analyze multiple images with chunking and concurrency control
   * @param items - Array of {path, buffer} objects
   * @returns Promise resolving to ImageDescriptor array
   */
  analyzeBatch(items: Array<{path: string, buffer: Buffer}>): Promise<ImageDescriptor[]>;
  
  /**
   * Estimate cost for analyzing images (dry-run)
   * @param imageCount - Number of images to analyze
   * @returns Promise resolving to cost estimate
   */
  estimateCost(imageCount: number): Promise<CostEstimate>;
  
  /**
   * Validate provider configuration and connectivity
   * @returns Promise resolving to true if provider is ready
   */
  validateConfig?(): Promise<boolean>;
  
  /**
   * Clean up provider resources (close connections, clear cache)
   */
  cleanup?(): Promise<void>;
}

/**
 * Provider factory configuration
 */
export const ProviderFactoryConfigSchema = z.object({
  provider: z.enum(['sharp', 'gemini']).default('sharp'),
  rolloutPercent: z.number().min(0).max(100).default(0),
  killSwitch: z.boolean().default(false),
  cacheEnabled: z.boolean().default(true),
  maxCacheSize: z.number().int().positive().default(256),
  diskCacheEnabled: z.boolean().default(false),
}).strict();

export type ProviderFactoryConfig = z.infer<typeof ProviderFactoryConfigSchema>;

/**
 * RFC 7807 Problem+JSON error taxonomy for analyze providers
 */
export const AnalyzeErrorSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  detail: z.string().optional(),
  status: z.number().int().min(400).max(599),
  instance: z.string().optional(),
  provider: z.enum(['sharp', 'gemini']).optional(),
  retryable: z.boolean().default(false),
  costIncurred: z.number().min(0).default(0),
}).strict();

export type AnalyzeError = z.infer<typeof AnalyzeErrorSchema>;

/**
 * Standard error types for provider implementations
 */
export const ANALYZE_ERROR_TYPES = {
  RATE_LIMITED: 'rate_limited',
  INVALID_JSON: 'invalid_json', 
  TIMEOUT: 'timeout',
  UPSTREAM_ERROR: 'upstream_error',
  INVALID_IMAGE: 'invalid_image',
  QUOTA_EXCEEDED: 'quota_exceeded',
} as const;

/**
 * Provider metrics interface for observability
 */
export interface ProviderMetrics {
  requestsTotal: number;
  failuresTotal: number;
  rateLimitedTotal: number;
  latencyHistogram: number[];
  costTotal: number;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Image preprocessing configuration
 */
export const ImagePreprocessConfigSchema = z.object({
  maxEdgePixels: z.number().int().positive().default(1536),
  quality: z.number().min(0.1).max(1.0).default(0.8),
  format: z.enum(['jpeg', 'png', 'webp']).default('jpeg'),
  stripMetadata: z.boolean().default(true),
}).strict();

export type ImagePreprocessConfig = z.infer<typeof ImagePreprocessConfigSchema>;