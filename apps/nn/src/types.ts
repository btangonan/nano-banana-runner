import { z } from 'zod';

// Image Analysis Types
export const ImageDescriptorSchema = z.object({
  path: z.string(),
  hash: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  palette: z.array(z.string()).max(10),
  subjects: z.array(z.string()),
  style: z.array(z.string()),
  lighting: z.array(z.string()),
  camera: z.object({
    lens: z.string().optional(),
    f: z.number().positive().optional(),
  }).optional(),
  errors: z.array(z.string()).optional(),
}).strict();

export type ImageDescriptor = z.infer<typeof ImageDescriptorSchema>;

// Prompt Types
export const PromptRowSchema = z.object({
  prompt: z.string().min(1).max(2000),
  sourceImage: z.string(),
  tags: z.array(z.string()),
  seed: z.number().int().optional(),
  strength: z.number().min(0).max(1).optional(),
  _meta: z.object({
    hashDistance: z.number().optional(),
    flagged: z.boolean().optional(),
  }).optional(),
}).strict();

export type PromptRow = z.infer<typeof PromptRowSchema>;

// Render Types
export const RenderRequestSchema = z.object({
  rows: z.array(PromptRowSchema),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  styleOnly: z.literal(true),
  styleRefs: z.array(z.string()),
  runMode: z.enum(['dry_run', 'live']),
}).strict();

export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export const RenderResultSchema = z.object({
  results: z.array(z.object({
    id: z.string().uuid(),
    prompt: z.string(),
    outPath: z.string(),
    styleDistance: z.number().optional(),
  })),
  costPlan: z.object({
    imageCount: z.number(),
    estimatedCost: z.number(),
    estimatedTime: z.string(),
  }).optional(),
}).strict();

export type RenderResult = z.infer<typeof RenderResultSchema>;

// CSV Types
export const CSVRowSchema = z.object({
  id: z.string().uuid(),
  key: z.string().length(64),
  sourceImage: z.string(),
  prompt: z.string().max(2000),
  tags: z.string(), // JSON array as string
  seed: z.number().optional(),
  strength: z.number().min(0).max(1).optional(),
}).strict();

export type CSVRow = z.infer<typeof CSVRowSchema>;

// Duplicate Detection Types
export const DupClusterSchema = z.object({
  leaderId: z.string(),
  memberIds: z.array(z.string()),
  scores: z.array(z.number()),
}).strict();

export type DupCluster = z.infer<typeof DupClusterSchema>;

export const DupReportSchema = z.object({
  clusters: z.array(DupClusterSchema),
  totalDuplicates: z.number(),
  largestClusterSize: z.number(),
  processingTime: z.string(),
}).strict();

export type DupReport = z.infer<typeof DupReportSchema>;

// Problem+JSON (RFC 7807)
export const ProblemSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  detail: z.string().optional(),
  status: z.number().int().min(400).max(599),
  instance: z.string().uuid(),
}).strict();

export type Problem = z.infer<typeof ProblemSchema>;

/**
 * Create RFC 7807 Problem+JSON object with correlation UUID
 */
export function createProblem(
  title: string,
  detail: string,
  status: number,
  type: string = 'about:blank'
): Problem {
  return ProblemSchema.parse({
    type,
    title,
    detail,
    status,
    instance: crypto.randomUUID(),
  });
}

// Manifest Types
export const ManifestEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  operation: z.enum(['analyze', 'remix', 'render', 'export', 'import', 'dedupe']),
  input: z.string(),
  output: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  version: z.string(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  entries: z.array(ManifestEntrySchema),
}).strict();

export type Manifest = z.infer<typeof ManifestSchema>;

// Provider Interfaces

// Synchronous provider (existing, for Vertex fallback)
export interface ImageGenProvider {
  render(batch: {
    rows: PromptRow[];
    variants: 1 | 2 | 3;
    styleOnly: boolean;
    styleRefs: string[];
    runMode: 'dry_run' | 'live';
  }): Promise<RenderResult>;
}

// Asynchronous provider (new, for Gemini Batch)
export interface AsyncImageGenProvider {
  submit(req: { 
    jobId?: string;  // Optional job ID to use (if not provided, provider will generate one)
    rows: PromptRow[]; 
    variants: 1 | 2 | 3; 
    styleOnly: true; 
    styleRefs: string[]; 
  }): Promise<{ jobId: string; estCount: number }>;
  
  poll(jobId: string): Promise<{ 
    status: 'pending' | 'running' | 'succeeded' | 'failed'; 
    completed?: number; 
    total?: number; 
    errors?: Problem[] 
  }>;
  
  fetch(jobId: string, outDir: string): Promise<{ 
    results: Array<{ id: string; prompt: string; outPath: string }>; 
    problems: Problem[] 
  }>;
  
  cancel(jobId: string): Promise<{ 
    status: 'canceled' | 'not_found' 
  }>;
}

// Job manifest for tracking batch jobs
export const JobManifestSchema = z.object({
  jobId: z.string(),
  provider: z.enum(['gemini-batch', 'vertex']),
  submittedAt: z.string().datetime(),
  estCount: z.number(),
  promptsHash: z.string().optional(),
  styleRefsHash: z.string().optional(),
  statusHistory: z.array(z.object({
    timestamp: z.string().datetime(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'canceled']),
    completed: z.number().optional(),
    total: z.number().optional(),
  })),
  problems: z.array(ProblemSchema).optional(),
}).strict();

export type JobManifest = z.infer<typeof JobManifestSchema>;

// Provider Types for per-job overrides
export type ProviderName = "batch" | "vertex";

export interface SubmitOptions {
  provider?: ProviderName;        // per-job override (optional)
  promptsPath: string;
  styleDir?: string;
  refsPath?: string;
  refMode?: string;
  variants: 1 | 2 | 3;
  compress?: boolean;
  split?: boolean;
  live?: boolean;
  yes?: boolean;
  dryRun: boolean;
}

// Configuration Types
export const ConfigSchema = z.object({
  provider: z.enum(['gemini', 'mock']).default('gemini'),
  outDir: z.string().default('./artifacts'),
  concurrency: z.number().int().min(1).max(10).default(2),
  maxPerImage: z.number().int().min(1).max(100).default(50),
  verbose: z.boolean().default(false),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;