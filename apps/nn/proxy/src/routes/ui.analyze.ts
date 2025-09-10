import { FastifyInstance } from "fastify";
import { z } from "zod";
import { runAnalyze } from "../../../src/workflows/runAnalyze.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ImageDescriptor } from "../../../src/types.js";

/**
 * Analysis route that invokes the existing runAnalyze workflow
 * POST /ui/analyze - analyze images in ./images/ directory
 */
export default async function analyzeRoutes(fastify: FastifyInstance) {
  const REQUEST_SCHEMA = z.object({
    inDir: z.string().default('./images'),
    // Coerce to number in case it comes as string from forms
    concurrency: z.coerce.number().int().min(1).max(10).default(4),
  }).strict();

  fastify.post('/ui/analyze', async (request, reply) => {
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
          instance: crypto.randomUUID(),
        });
      }

      const { inDir, concurrency } = validation.data;
      const outputPath = './artifacts/descriptors.json';

      // Security: validate directory path (prevent traversal)
      if (inDir.includes('..') || inDir.includes('~')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid directory path',
          detail: 'Directory path must not contain path traversal sequences',
          status: 400,
          instance: crypto.randomUUID(),
        });
      }

      fastify.log.info({
        inDir,
        outputPath,
        concurrency,
      }, 'Starting image analysis via API');

      // Call existing runAnalyze workflow
      await runAnalyze({
        inDir,
        outPath: outputPath,
        concurrency,
      });

      // Read the generated descriptors to get counts and sample data
      const descriptorsContent = await readFile(outputPath, 'utf-8');
      const descriptors: ImageDescriptor[] = JSON.parse(descriptorsContent);

      // Count successful vs failed analyses
      const successful = descriptors.filter(d => !d.errors?.length);
      const failed = descriptors.filter(d => d.errors?.length);

      // Get a sample of the first 3 successful descriptors for preview
      // Only include successfully analyzed images in the sample
      const sample = successful.slice(0, 3);

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const response = {
        count: descriptors.length,
        successful: successful.length,
        failed: failed.length,
        duration,
        sample,
        outputPath,
      };

      fastify.log.info({
        count: descriptors.length,
        successful: successful.length,
        failed: failed.length,
        duration,
        outputPath,
      }, 'Image analysis completed via API');

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Image analysis failed via API');

      // Check if it's a specific known error
      if (error instanceof Error) {
        if (error.message.includes('No supported images found')) {
          return reply.code(400).send({
            type: 'about:blank',
            title: 'No images to analyze',
            detail: 'No supported image files found in the specified directory. Please upload some images first.',
            status: 400,
            instance: crypto.randomUUID(),
          });
        }

        if (error.message.includes('ENOENT')) {
          return reply.code(404).send({
            type: 'about:blank',
            title: 'Directory not found',
            detail: 'The specified input directory does not exist. Please upload some images first.',
            status: 404,
            instance: crypto.randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Analysis failed',
        detail: 'An error occurred while analyzing the images. Please check the server logs.',
        status: 500,
        instance: crypto.randomUUID(),
      });
    }
  });

  fastify.log.info('Analysis route registered at POST /ui/analyze');
}