import { z } from "zod";

// Re-export Problem from backend types
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  detail: z.string().optional(),
  status: z.number().int().min(400).max(599),
  instance: z.string().uuid(),
}).strict();

export type Problem = z.infer<typeof Problem>;

// Image Descriptor (matches backend ImageDescriptorSchema)
export const Descriptor = z.object({
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

export type Descriptor = z.infer<typeof Descriptor>;

// Upload API schemas
export const UploadRequest = z.object({
  files: z.array(z.object({
    filename: z.string().min(1).max(255),
    size: z.number().positive().max(15 * 1024 * 1024), // 15MB max
    mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  }))
}).strict();

export const UploadResponse = z.object({
  uploaded: z.number().min(0),
  files: z.array(z.object({
    filename: z.string(),
    path: z.string(),
    size: z.number(),
  })),
  warnings: z.array(z.string()).optional(),
}).strict();

export type UploadRequest = z.infer<typeof UploadRequest>;
export type UploadResponse = z.infer<typeof UploadResponse>;

// Analyze API schemas
export const AnalyzeRequest = z.object({
  inDir: z.string().min(1),
  concurrency: z.number().int().min(1).max(10).default(4),
}).strict();

export const AnalyzeResponse = z.object({
  count: z.number().min(0),
  successful: z.number().min(0),
  failed: z.number().min(0),
  duration: z.string(), // e.g., "2.3s"
  sample: z.array(Descriptor).max(3).optional(), // First 3 for preview
  outputPath: z.string(),
}).strict();

export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;

// API Error response wrapper
export const ApiResponse = <T extends z.ZodTypeAny>(dataSchema: T) => z.object({
  success: z.literal(true),
  data: dataSchema,
}).or(z.object({
  success: z.literal(false),
  problem: Problem,
}));

export type ApiResponse<T> = { success: true; data: T } | { success: false; problem: Problem };