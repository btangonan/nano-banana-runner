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
  provider: z.string().optional(), // 'sharp' or 'gemini'
  path: z.string(),
  hash: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  format: z.string().optional(), // 'png', 'jpeg', 'webp', etc.
  palette: z.array(z.string()).max(10),
  subjects: z.array(z.string()),
  style: z.array(z.string()),
  lighting: z.union([z.string(), z.array(z.string())]), // Can be string or array
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

// Clear session API schemas
export const ClearResponse = z.object({
  cleared: z.boolean(),
  message: z.string().optional(),
}).strict();

export type ClearResponse = z.infer<typeof ClearResponse>;

// Prompt Row (matches backend PromptRowSchema)
export const PromptRow = z.object({
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

export type PromptRow = z.infer<typeof PromptRow>;

// Remix API schemas
export const RemixRequest = z.object({
  descriptorsPath: z.string().default('./artifacts/descriptors.json'),
  maxPerImage: z.number().int().min(1).max(100).default(10),
  seed: z.number().int().default(42),
}).strict();

export const RemixResponse = z.object({
  count: z.number().min(0),
  sourceImages: z.number().min(0),
  avgPerImage: z.number().min(0),
  duration: z.string(),
  sample: z.array(PromptRow).max(5).optional(),
  outputPath: z.string(),
  promptsBySource: z.record(z.string(), z.number()),
}).strict();

export type RemixRequest = z.infer<typeof RemixRequest>;
export type RemixResponse = z.infer<typeof RemixResponse>;

// Save Prompts API schemas
export const SavePromptsRequest = z.object({
  prompts: z.array(PromptRow).min(1).max(10000),
  outputPath: z.string().default('./artifacts/prompts.jsonl'),
  format: z.enum(['jsonl', 'csv']).default('jsonl'),
}).strict();

export const SavePromptsResponse = z.object({
  success: z.literal(true),
  outputPath: z.string(),
  format: z.enum(['jsonl', 'csv']),
  saved: z.number().min(0),
  sourceImages: z.number().min(0),
  avgPerImage: z.number().min(0),
  duration: z.string(),
  promptsBySource: z.record(z.string(), z.number()),
}).strict();

export type SavePromptsRequest = z.infer<typeof SavePromptsRequest>;
export type SavePromptsResponse = z.infer<typeof SavePromptsResponse>;

// Preflight API schemas
export const PreflightRequest = z.object({
  promptsPath: z.string().default('./artifacts/prompts.jsonl'),
  styleDir: z.string().optional(),
  referencePack: z.string().optional(),
  provider: z.enum(['gemini-batch', 'vertex-ai']).default('gemini-batch'),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
}).strict();

export const PreflightResponse = z.object({
  validation: z.object({
    ok: z.boolean(),
    promptCount: z.number(),
    chunks: z.number(),
    uniqueRefs: z.number(),
    problems: z.array(z.any()),
  }),
  costEstimate: z.object({
    provider: z.string(),
    variants: z.number(),
    totalImages: z.number(),
    costPerImage: z.number(),
    estimatedCost: z.number(),
    estimatedTime: z.string(),
    currency: z.string(),
  }),
  resources: z.object({
    bytesBeforeCompression: z.number(),
    bytesAfterCompression: z.number(),
    compressionRatio: z.number(),
    referencesFound: z.number(),
  }),
  recommendations: z.array(z.string()),
  duration: z.string(),
}).strict();

export type PreflightRequest = z.infer<typeof PreflightRequest>;
export type PreflightResponse = z.infer<typeof PreflightResponse>;

// Submit API schemas
export const SubmitRequest = z.object({
  promptsPath: z.string().default('./artifacts/prompts.jsonl'),
  styleDir: z.string().default('./images'),
  referencePack: z.string().optional(),
  provider: z.enum(['gemini-batch', 'vertex-ai']).default('gemini-batch'),
  refMode: z.enum(['style', 'prop', 'subject', 'pose', 'environment', 'mixed']).default('style'),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  concurrency: z.number().int().min(1).max(10).default(2),
  outDir: z.string().default('./outputs'),
  runMode: z.enum(['dry-run', 'live']).default('dry-run'),
  compress: z.boolean().default(true),
  split: z.boolean().default(true),
}).strict();

export const SubmitResponse = z.object({
  jobId: z.string().uuid(),
  status: z.literal('submitted'),
  provider: z.string(),
  runMode: z.enum(['dry-run', 'live']),
  prompts: z.number(),
  estimatedImages: z.number(),
  variants: z.number(),
  message: z.string(),
  pollUrl: z.string(),
  fetchUrl: z.string(),
  duration: z.string(),
}).strict();

export type SubmitRequest = z.infer<typeof SubmitRequest>;
export type SubmitResponse = z.infer<typeof SubmitResponse>;

// Poll API schemas
export const PollRequest = z.object({
  jobId: z.string().uuid(),
}).strict();

export const PollResponse = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['submitted', 'running', 'completed', 'failed']),
  provider: z.string(),
  prompts: z.number(),
  estimatedImages: z.number(),
  timing: z.object({
    startTime: z.string().datetime(),
    elapsedTime: z.string(),
    estimatedRemaining: z.string().optional(),
    endTime: z.string().datetime().optional(),
  }),
  progress: z.object({
    current: z.number(),
    total: z.number(),
    percentage: z.number(),
    stage: z.string(),
  }).optional(),
  duration: z.string(),
}).and(z.union([
  // Completed response
  z.object({
    completed: z.literal(true),
    result: z.object({
      message: z.string(),
      outputLocation: z.string(),
      dryRunStats: z.object({
        promptCount: z.number(),
        variants: z.number(),
        estimatedImages: z.number(),
        estimatedTime: z.string(),
        estimatedCost: z.string(),
        provider: z.string(),
      }).optional(),
    }),
    actions: z.object({
      fetchResults: z.string(),
      viewGallery: z.string(),
    }),
  }),
  // Failed response  
  z.object({
    failed: z.literal(true),
    error: z.object({
      message: z.string(),
      recoverable: z.boolean(),
    }),
    actions: z.object({
      retry: z.string(),
      logs: z.string(),
    }),
  }),
  // Running response
  z.object({
    running: z.literal(true),
    nextPollIn: z.number(),
    actions: z.object({
      cancel: z.string(),
    }),
  }),
  // Submitted response
  z.object({
    waiting: z.literal(true),
    message: z.string(),
    nextPollIn: z.number(),
  }),
]));

export type PollRequest = z.infer<typeof PollRequest>;
export type PollResponse = z.infer<typeof PollResponse>;

// Fetch API schemas
export const FetchRequest = z.object({
  jobId: z.string().uuid(),
  format: z.enum(['json', 'gallery', 'download']).default('json'),
  // Numbers in query params are handled on the server side
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export const FetchResponse = z.object({
  jobId: z.string().uuid(),
  status: z.literal('completed'),
  format: z.enum(['json', 'gallery']),
  results: z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
  }).and(z.union([
    // JSON format
    z.object({
      files: z.array(z.object({
        path: z.string(),
        name: z.string(),
        size: z.number(),
        modified: z.string().datetime(),
        type: z.string(),
      })),
    }),
    // Gallery format
    z.object({
      items: z.array(z.object({
        id: z.string().uuid(),
        name: z.string(),
        size: z.number(),
        modified: z.string().datetime(),
        type: z.string(),
        dataUrl: z.string().optional(),
        error: z.string().optional(),
        downloadUrl: z.string(),
      })),
    }),
  ])),
  job: z.object({
    provider: z.string(),
    prompts: z.number(),
    estimatedImages: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime().optional(),
    duration: z.string().optional(),
  }),
  actions: z.object({
    downloadAll: z.string(),
    nextPage: z.string().optional(),
    gallery: z.string().optional(),
  }),
  duration: z.string(),
});

export type FetchRequest = z.infer<typeof FetchRequest>;
export type FetchResponse = z.infer<typeof FetchResponse>;

// API Error response wrapper
export const ApiResponse = <T extends z.ZodTypeAny>(dataSchema: T) => z.object({
  success: z.literal(true),
  data: dataSchema,
}).or(z.object({
  success: z.literal(false),
  problem: Problem,
}));

export type ApiResponse<T> = { success: true; data: T } | { success: false; problem: Problem };