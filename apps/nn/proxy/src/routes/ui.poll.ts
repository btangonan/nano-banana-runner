import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";

/**
 * Job polling route for status updates
 * GET /ui/poll?jobId=uuid - poll job status and progress
 */
export default async function pollRoutes(fastify: FastifyInstance) {
  const QUERY_SCHEMA = z.object({
    jobId: z.string().uuid(),
  }).strict();

  fastify.get('/ui/poll', async (request, reply) => {
    const startTime = Date.now();
    
    try {
      // Validate query parameters
      const validation = QUERY_SCHEMA.safeParse(request.query);
      if (!validation.success) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid request',
          detail: `Validation failed: ${validation.error.errors.map(e => e.message).join(', ')}`,
          status: 400,
          instance: randomUUID(),
        });
      }

      const { jobId } = validation.data;

      // Get jobs map from fastify instance (set by ui.submit.ts)
      const jobs = fastify.jobs;
      if (!jobs) {
        return reply.code(500).send({
          type: 'about:blank',
          title: 'Job tracking unavailable',
          detail: 'Job tracking system is not initialized.',
          status: 500,
          instance: randomUUID(),
        });
      }

      // Find the job
      const job = jobs.get(jobId);
      if (!job) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Job not found',
          detail: `No job found with ID ${jobId}. The job may have expired or never existed.`,
          status: 404,
          instance: randomUUID(),
        });
      }

      fastify.log.debug({
        jobId,
        status: job.status,
        progress: job.progress,
      }, 'Job status polled via API');

      // Calculate timing info - handle case where startTime might not be a Date object
      const now = new Date();
      const startTime = job.startTime instanceof Date ? job.startTime : new Date(job.startTime);
      const elapsed = now.getTime() - startTime.getTime();
      const elapsedSeconds = Math.floor(elapsed / 1000);
      const elapsedMinutes = Math.floor(elapsedSeconds / 60);
      const elapsedTime = elapsedMinutes > 0 
        ? `${elapsedMinutes}m ${elapsedSeconds % 60}s`
        : `${elapsedSeconds}s`;

      let estimatedRemaining: string | undefined;
      if (job.status === 'running' && job.progress && job.progress.current > 0) {
        const progressRatio = job.progress.current / job.progress.total;
        const totalEstimated = elapsed / progressRatio;
        const remainingMs = totalEstimated - elapsed;
        const remainingSeconds = Math.floor(remainingMs / 1000);
        const remainingMinutes = Math.floor(remainingSeconds / 60);
        estimatedRemaining = remainingMinutes > 0
          ? `${remainingMinutes}m ${remainingSeconds % 60}s`
          : `${Math.max(0, remainingSeconds)}s`;
      }

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      // Build response based on job status
      const baseResponse = {
        jobId,
        status: job.status,
        provider: job.provider,
        prompts: job.promptCount,
        estimatedImages: job.estimatedImages,
        timing: {
          startTime: startTime.toISOString(),
          elapsedTime,
          estimatedRemaining,
          endTime: job.endTime ? (job.endTime instanceof Date ? job.endTime.toISOString() : new Date(job.endTime).toISOString()) : undefined,
        },
        progress: job.progress ? {
          current: job.progress.current,
          total: job.progress.total,
          percentage: Math.round((job.progress.current / job.progress.total) * 100),
          stage: job.progress.stage,
        } : undefined,
        duration,
      };

      // Add status-specific fields
      let response: any = baseResponse;

      if (job.status === 'completed') {
        // Build a schema-safe result for both live & dry-run
        let result: any = {
          message: 'Job completed successfully',
          outputLocation: './outputs',
        };
        
        if (job.result) {
          result = {
            message: job.result.message ?? 'Dry-run complete',
            outputLocation: job.result.outputLocation ?? './outputs',
          };
          
          // Attach dryRunStats if we detect a dry-run object
          if (typeof job.result.estimatedImages === 'number') {
            result.dryRunStats = {
              promptCount: job.result.promptCount ?? 0,
              variants: job.result.variants ?? 1,
              estimatedImages: job.result.estimatedImages,
              estimatedTime: job.result.estimatedTime ?? 'unknown',
              estimatedCost: job.result.estimatedCost ?? '$0.0000',
              provider: job.result.provider ?? 'gemini-batch',
            };
          }
        }
        
        response = {
          ...baseResponse,
          completed: true,
          result,
          actions: {
            fetchResults: `/ui/fetch?jobId=${jobId}`,
            viewGallery: `/app/gallery?jobId=${jobId}`,
          },
        };
      } else if (job.status === 'failed') {
        response = {
          ...baseResponse,
          failed: true,
          error: {
            message: job.error || 'Unknown error occurred',
            recoverable: isRecoverableError(job.error),
          },
          actions: {
            retry: `/ui/submit`, // User can resubmit
            logs: `/ui/logs?jobId=${jobId}`, // If we implement logging endpoint
          },
        };
      } else if (job.status === 'running') {
        response = {
          ...baseResponse,
          running: true,
          nextPollIn: 5000, // Suggest 5 second poll interval
          actions: {
            cancel: `/ui/cancel?jobId=${jobId}`, // If we implement cancellation
          },
        };
      } else if (job.status === 'submitted') {
        response = {
          ...baseResponse,
          waiting: true,
          message: 'Job submitted and waiting to start',
          nextPollIn: 2000, // Poll more frequently for submitted jobs
        };
      }

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        jobId: request.query ? (request.query as any).jobId : undefined,
        duration,
      }, 'Job polling failed via API');

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Polling failed',
        detail: 'An error occurred while checking job status. Please try again.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info('Poll route registered at GET /ui/poll');
}

/**
 * Determine if an error is recoverable (user can retry)
 */
function isRecoverableError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  
  // Transient errors that can be retried
  const recoverableErrors = [
    'timeout',
    'network',
    'connection',
    'rate limit',
    'temporary',
    'busy',
    'unavailable',
    '429', // Rate limited
    '503', // Service unavailable
    '502', // Bad gateway
  ];

  const lowerMessage = errorMessage.toLowerCase();
  return recoverableErrors.some(pattern => lowerMessage.includes(pattern));
}