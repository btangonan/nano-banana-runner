import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { runBatchSubmit } from "../../../src/workflows/runBatchSubmit.js";
import { runRender } from "../../../src/workflows/runRender.js";
import { readFile, mkdir } from "node:fs/promises";
import { PromptRow, PromptRowSchema } from "../../../src/types.js";
import { RefMode } from "../../../src/types/refs.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Job submission route for image generation
 * POST /ui/submit - submit render job (dry-run or live)
 */
export default async function submitRoutes(fastify: FastifyInstance) {
  const REQUEST_SCHEMA = z.object({
    promptsPath: z.string().default('./artifacts/prompts.jsonl'),
    styleDir: z.string().default('./images'),
    referencePack: z.string().optional(), // Path to refs.json/yaml
    provider: z.enum(['gemini-batch', 'vertex-ai']).default('gemini-batch'),
    refMode: z.enum(['style', 'prop', 'subject', 'pose', 'environment', 'mixed']).default('style'),
    variants: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    concurrency: z.number().int().min(1).max(10).default(2),
    outDir: z.string().default('./outputs'),
    runMode: z.enum(['dry-run', 'live']).default('dry-run'),
    compress: z.boolean().default(true),
    split: z.boolean().default(true),
  }).strict();

  // In-memory job tracking (simple implementation)
  const jobs = new Map<string, {
    id: string;
    status: 'submitted' | 'running' | 'completed' | 'failed';
    provider: string;
    promptCount: number;
    estimatedImages: number;
    startTime: Date;
    endTime?: Date;
    progress?: {
      current: number;
      total: number;
      stage: string;
    };
    result?: any;
    error?: string;
  }>();

  fastify.post('/ui/submit', async (request, reply) => {
    const startTime = Date.now();
    
    try {
      // Validate request body
      const validation = REQUEST_SCHEMA.safeParse(request.body);
      if (!validation.success) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid request',
          detail: `Validation failed: ${validation.error.errors.map(e => e.message).join(', ')}`,
          status: 400,
          instance: randomUUID(),
        });
      }

      const { 
        promptsPath, 
        styleDir, 
        referencePack, 
        provider, 
        refMode,
        variants, 
        concurrency,
        outDir,
        runMode,
        compress,
        split 
      } = validation.data;

      // Security: validate file paths (prevent traversal)
      if (promptsPath.includes('..') || promptsPath.includes('~')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid file path',
          detail: 'Prompts path must not contain path traversal sequences',
          status: 400,
          instance: randomUUID(),
        });
      }

      if (styleDir.includes('..') || styleDir.includes('~')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid directory path',
          detail: 'Style directory path must not contain path traversal sequences',
          status: 400,
          instance: randomUUID(),
        });
      }

      // Generate unique job ID
      const jobId = randomUUID();

      fastify.log.info({
        jobId,
        promptsPath,
        styleDir,
        provider,
        refMode,
        variants,
        runMode,
      }, 'Starting image generation job submission via API');

      // Check if prompts file exists
      if (!existsSync(promptsPath)) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Prompts file not found',
          detail: `The prompts file at ${promptsPath} does not exist. Please generate prompts first.`,
          status: 404,
          instance: randomUUID(),
        });
      }

      // Check if style directory exists
      if (!existsSync(styleDir)) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Style directory not found',
          detail: `The style directory at ${styleDir} does not exist. Please upload reference images first.`,
          status: 404,
          instance: randomUUID(),
        });
      }

      // Load and validate prompts to get count
      const promptsContent = await readFile(promptsPath, 'utf-8');
      const lines = promptsContent.trim().split('\n').filter(line => line.trim());
      
      let promptCount = 0;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          PromptRowSchema.parse(parsed); // Validate format
          promptCount++;
        } catch (error) {
          return reply.code(400).send({
            type: 'about:blank',
            title: 'Invalid prompt format',
            detail: `Prompts file contains invalid entries. Please regenerate prompts.`,
            status: 400,
            instance: randomUUID(),
          });
        }
      }

      if (promptCount === 0) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'No valid prompts',
          detail: 'The prompts file contains no valid prompt entries.',
          status: 400,
          instance: randomUUID(),
        });
      }

      // Ensure output directory exists
      try {
        await mkdir(outDir, { recursive: true });
      } catch (error) {
        fastify.log.warn({ outDir, error }, 'Could not create output directory');
      }

      const estimatedImages = promptCount * variants;

      // Create job record
      const job = {
        id: jobId,
        status: 'submitted' as const,
        provider,
        promptCount,
        estimatedImages,
        startTime: new Date(),
        progress: {
          current: 0,
          total: estimatedImages,
          stage: 'initializing',
        },
      };
      jobs.set(jobId, job);

      // Execute workflow asynchronously
      const workflowPromise = executeWorkflow(
        provider,
        {
          promptsPath,
          styleDir,
          referencePack,
          refMode: refMode as RefMode,
          variants,
          concurrency,
          outDir,
          runMode,
          compress,
          split,
        },
        jobId,
        jobs,
        fastify
      );

      // Don't await - return immediately with job ID
      workflowPromise.catch(error => {
        fastify.log.error({ jobId, error: error.message }, 'Workflow execution failed');
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
          job.endTime = new Date();
        }
      });

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const response = {
        jobId,
        status: 'submitted',
        provider,
        runMode,
        prompts: promptCount,
        estimatedImages,
        variants,
        message: runMode === 'dry-run' 
          ? 'Dry-run job submitted - no actual images will be generated'
          : 'Live job submitted - image generation starting',
        pollUrl: `/ui/poll?jobId=${jobId}`,
        fetchUrl: `/ui/fetch?jobId=${jobId}`,
        duration,
      };

      fastify.log.info({
        jobId,
        provider,
        promptCount,
        estimatedImages,
        runMode,
        duration,
      }, 'Job submitted successfully via API');

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Job submission failed via API');

      // Check for specific known errors
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          return reply.code(404).send({
            type: 'about:blank',
            title: 'File not found',
            detail: 'One or more required files could not be found. Please check your file paths.',
            status: 404,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('EACCES')) {
          return reply.code(403).send({
            type: 'about:blank',
            title: 'Permission denied',
            detail: 'Cannot access the required files or directories. Please check permissions.',
            status: 403,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('ENOSPC')) {
          return reply.code(507).send({
            type: 'about:blank',
            title: 'Insufficient storage',
            detail: 'Not enough disk space to process the job.',
            status: 507,
            instance: randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Submission failed',
        detail: 'An error occurred while submitting the job. Please check the server logs.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  // Expose jobs map for other routes
  fastify.decorate('jobs', jobs);

  fastify.log.info('Submit route registered at POST /ui/submit');
}

/**
 * Execute the appropriate workflow based on provider
 */
async function executeWorkflow(
  provider: string,
  options: any,
  jobId: string,
  jobs: Map<string, any>,
  fastify: FastifyInstance
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'running';
    job.progress.stage = 'starting';

    if (provider === 'gemini-batch') {
      // Use batch submission workflow
      job.progress.stage = 'batch-submit';
      await runBatchSubmit({
        promptsPath: options.promptsPath,
        styleDir: options.styleDir,
        refsPath: options.referencePack,
        refMode: options.refMode,
        variants: options.variants,
        compress: options.compress,
        split: options.split,
        dryRun: options.runMode === 'dry-run',
      });
    } else {
      // Use direct render workflow
      job.progress.stage = 'rendering';
      await runRender({
        promptsPath: options.promptsPath,
        styleDir: options.styleDir,
        outDir: options.outDir,
        variants: options.variants,
        concurrency: options.concurrency,
        dryRun: options.runMode === 'dry-run',
      });
    }

    // Mark as completed
    job.status = 'completed';
    job.endTime = new Date();
    job.progress.current = job.progress.total;
    job.progress.stage = 'completed';

    fastify.log.info({ jobId, provider }, 'Workflow execution completed');

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.endTime = new Date();
    job.progress.stage = 'failed';
    throw error;
  }
}

// Extend FastifyInstance type
declare module "fastify" {
  interface FastifyInstance {
    jobs: Map<string, any>;
  }
}