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
    provider: z.enum(['batch', 'vertex']).optional(), // Per-job provider override
    refMode: z.enum(['style', 'prop', 'subject', 'pose', 'environment', 'mixed']).default('style'),
    variants: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    concurrency: z.number().int().min(1).max(10).default(2),
    outDir: z.string().default('./outputs'),
    runMode: z.enum(['dry-run', 'live']).default('dry-run'),
    compress: z.boolean().default(true),
    split: z.boolean().default(true),
  }).strict();

  // Jobs Map is now initialized in server.ts and available via fastify.jobs

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
        provider,  // Per-job provider override
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
        provider: provider || 'default',
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
      fastify.jobs.set(jobId, job);

      // Execute workflow asynchronously
      const workflowPromise = executeWorkflow(
        provider, // Pass the provider override
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
        fastify
      );

      // Don't await - return immediately with job ID
      workflowPromise.catch(error => {
        fastify.log.error({ jobId, error: error.message }, 'Workflow execution failed');
        const job = fastify.jobs.get(jobId);
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
        provider: provider || 'default',
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

  // Jobs Map is already exposed via server.ts initialization

  fastify.log.info('Submit route registered at POST /ui/submit');
}

/**
 * Execute the appropriate workflow based on provider
 */
async function executeWorkflow(
  provider: string,
  options: any,
  jobId: string,
  fastify: FastifyInstance
): Promise<void> {
  const job = fastify.jobs.get(jobId);
  if (!job) return;

  // Capture dry-run output (moved to outer scope for proper visibility)
  let dryRunOutput: any = null;
  
  try {
    job.status = 'running';
    job.progress.stage = 'starting';

    // Always use batch submission workflow with provider override
    job.progress.stage = 'batch-submit';
    
    // For dry-run, we need to capture console output
    if (options.runMode === 'dry-run') {
      const { readFile } = await import('node:fs/promises');
      const promptsContent = await readFile(options.promptsPath, 'utf-8');
      const promptCount = promptsContent.trim().split('\n').filter(line => line.trim()).length;
      const estimatedImages = promptCount * options.variants;
      const estimatedTime = Math.ceil(estimatedImages / 4) * 3; // Rough estimate
      
      dryRunOutput = {
        promptCount,
        variants: options.variants,
        estimatedImages,
        estimatedTime: `${estimatedTime}s`,
        estimatedCost: provider === 'vertex' 
          ? `$${(estimatedImages * 0.0025).toFixed(4)}` 
          : `$${(estimatedImages * 0.000125).toFixed(4)}`,
        message: 'Dry-run complete. Run with --live to submit actual job.',
        provider: provider || 'batch'
      };
    }
    
    await runBatchSubmit({
      provider: provider, // Pass provider override to workflow
      promptsPath: options.promptsPath,
      styleDir: options.styleDir,
      refsPath: options.referencePack,
      refMode: options.refMode,
      variants: options.variants,
      compress: options.compress,
      split: options.split,
      dryRun: options.runMode === 'dry-run',
    });

    // Mark as completed with result
    job.status = 'completed';
    job.endTime = new Date();
    job.progress.current = job.progress.total;
    job.progress.stage = 'completed';
    
    // Store dry-run output if available
    if (dryRunOutput) {
      job.result = dryRunOutput;
    }

    fastify.log.info({ jobId, provider }, 'Workflow execution completed');

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.endTime = new Date();
    job.progress.stage = 'failed';
    throw error;
  }
}

// FastifyInstance type is extended in server.ts