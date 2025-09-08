import { FastifyInstance } from "fastify";
import { z } from "zod";
import { runRemix } from "../../../src/workflows/runRemix.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PromptRow } from "../../../src/types.js";

/**
 * Remix route that invokes the existing runRemix workflow
 * POST /ui/remix - generate prompts from image descriptors
 */
export default async function remixRoutes(fastify: FastifyInstance) {
  const REQUEST_SCHEMA = z.object({
    descriptorsPath: z.string().default('./artifacts/descriptors.json'),
    maxPerImage: z.number().int().min(1).max(100).default(10),
    seed: z.number().int().default(42),
  }).strict();

  fastify.post('/ui/remix', async (request, reply) => {
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

      const { descriptorsPath, maxPerImage, seed } = validation.data;
      const outputPath = './artifacts/prompts.jsonl';

      // Security: validate file paths (prevent traversal)
      if (descriptorsPath.includes('..') || descriptorsPath.includes('~') || 
          outputPath.includes('..') || outputPath.includes('~')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid file path',
          detail: 'File paths must not contain path traversal sequences',
          status: 400,
          instance: randomUUID(),
        });
      }

      fastify.log.info({
        descriptorsPath,
        outputPath,
        maxPerImage,
        seed,
      }, 'Starting prompt remix via API');

      // Call existing runRemix workflow
      await runRemix({
        descriptorsPath,
        outPath: outputPath,
        maxPerImage,
        seed,
      });

      // Read the generated prompts to get counts and sample data
      const promptsContent = await readFile(outputPath, 'utf-8');
      const promptLines = promptsContent.trim().split('\n').filter(line => line.trim());
      const prompts: PromptRow[] = promptLines.map(line => JSON.parse(line));

      // Group by source image to get statistics
      const promptsBySource = prompts.reduce((acc, prompt) => {
        acc[prompt.sourceImage] = (acc[prompt.sourceImage] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get a sample of the first 5 prompts for preview
      const sample = prompts.slice(0, 5);

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const response = {
        count: prompts.length,
        sourceImages: Object.keys(promptsBySource).length,
        avgPerImage: Math.round(prompts.length / Object.keys(promptsBySource).length * 100) / 100,
        duration,
        sample,
        outputPath,
        promptsBySource,
      };

      fastify.log.info({
        count: prompts.length,
        sourceImages: Object.keys(promptsBySource).length,
        avgPerImage: response.avgPerImage,
        duration,
        outputPath,
      }, 'Prompt remix completed via API');

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Prompt remix failed via API');

      // Check if it's a specific known error
      if (error instanceof Error) {
        if (error.message.includes('No image descriptors found')) {
          return reply.code(400).send({
            type: 'about:blank',
            title: 'No descriptors to remix',
            detail: 'No image descriptors found in the specified file. Please analyze some images first.',
            status: 400,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('No prompts were generated')) {
          return reply.code(400).send({
            type: 'about:blank',
            title: 'No prompts generated',
            detail: 'No prompts were generated from the provided descriptors. Please check the input data.',
            status: 400,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('ENOENT')) {
          return reply.code(404).send({
            type: 'about:blank',
            title: 'File not found',
            detail: 'The specified descriptors file does not exist. Please run analysis first.',
            status: 404,
            instance: randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Remix failed',
        detail: 'An error occurred while generating prompts. Please check the server logs.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info('Remix route registered at POST /ui/remix');
}