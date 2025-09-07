import { z } from 'zod';

/**
 * Reference kinds for multi-mode image generation
 */
export const ReferenceKind = z.enum([
  'style',      // Palette, texture, mood only
  'prop',       // Object presence without composition
  'subject',    // Identity/face preservation
  'pose',       // Posture/gesture matching
  'environment' // Ambience/architecture without foreground
]);
export type ReferenceKind = z.infer<typeof ReferenceKind>;

/**
 * Reference mode for generation
 */
export const RefMode = z.enum([
  'style',      // Style-only (default, safest)
  'prop',       // Props inclusion
  'subject',    // Subject identity
  'pose',       // Pose matching
  'environment', // Environment preservation
  'mixed'       // Multiple modes (uses dominance ladder)
]).default('style');
export type RefMode = z.infer<typeof RefMode>;

/**
 * Style reference - palette/texture/mood only
 */
export const RefStyle = z.object({
  path: z.string(),
  weight: z.number().min(0).max(1).default(1)
}).strict();

/**
 * Prop reference - ensure object presence
 */
export const RefProp = z.object({
  label: z.string(),
  path: z.string(),
  weight: z.number().min(0).max(1).default(1),
  required: z.boolean().default(false)
}).strict();

/**
 * Subject reference - identity preservation
 */
export const RefSubject = z.object({
  name: z.string(),
  face: z.string(),
  description: z.string().optional(),
  extras: z.record(z.any()).optional()
}).strict();

/**
 * Pose reference - posture/gesture matching
 */
export const RefPose = z.object({
  path: z.string(),
  description: z.string().optional(),
  keypoints: z.array(z.object({
    x: z.number(),
    y: z.number(),
    confidence: z.number().optional()
  })).optional()
}).strict();

/**
 * Environment reference - ambience/architecture
 */
export const RefEnvironment = z.object({
  path: z.string(),
  scene: z.string().optional(),
  preserve: z.array(z.string()).optional() // e.g., ["lighting", "architecture", "mood"]
}).strict();

/**
 * Complete reference pack for multi-mode generation
 */
export const ReferencePack = z.object({
  version: z.string().default('1.0'),
  style: z.array(RefStyle).optional(),
  props: z.array(RefProp).optional(),
  subject: z.array(RefSubject).optional(),
  pose: z.array(RefPose).optional(),
  environment: z.array(RefEnvironment).optional(),
  metadata: z.object({
    author: z.string().optional(),
    created: z.string().datetime().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  }).optional()
}).strict();
export type ReferencePack = z.infer<typeof ReferencePack>;

/**
 * Reference registry entry for deduplication
 */
export const RefRegistryEntry = z.object({
  id: z.string(),
  hash: z.string(), // SHA256 of file content
  path: z.string(),
  size: z.number(),
  compressed: z.boolean().default(false),
  compressedSize: z.number().optional(),
  mimeType: z.string().optional()
}).strict();
export type RefRegistryEntry = z.infer<typeof RefRegistryEntry>;

/**
 * Reference registry for deduplication across batch
 */
export const RefRegistry = z.object({
  entries: z.record(z.string(), RefRegistryEntry), // hash -> entry
  totalSize: z.number(),
  compressedSize: z.number(),
  uniqueCount: z.number()
}).strict();
export type RefRegistry = z.infer<typeof RefRegistry>;

/**
 * Preflight budget configuration
 */
export const PreflightBudgets = z.object({
  jobMaxBytes: z.number().default(200 * 1024 * 1024), // 200MB
  itemMaxBytes: z.number().default(8 * 1024 * 1024), // 8MB
  maxRefsPerItem: z.number().default(8),
  maxImagesPerJob: z.number().default(2000),
  compress: z.boolean().default(true),
  split: z.boolean().default(true)
}).strict();
export type PreflightBudgets = z.infer<typeof PreflightBudgets>;

/**
 * Preflight result after budget check and dedup
 */
export const PreflightResult = z.object({
  ok: z.boolean(),
  chunks: z.number(),
  uniqueRefs: z.number(),
  bytes: z.object({
    before: z.number(),
    after: z.number()
  }),
  registry: RefRegistry.optional(),
  problems: z.array(z.any()).optional()
}).strict();
export type PreflightResult = z.infer<typeof PreflightResult>;

/**
 * Mode dominance ladder for conflict resolution
 * Higher index = higher priority
 */
export const MODE_DOMINANCE: RefMode[] = [
  'prop',
  'style', 
  'environment',
  'pose',
  'subject' // Highest priority
];

/**
 * Get dominance priority (higher = more dominant)
 */
export function getModePriority(mode: RefMode): number {
  if (mode === 'mixed') return 0; // Mixed uses all with conflicts
  const index = MODE_DOMINANCE.indexOf(mode);
  return index === -1 ? 0 : index;
}