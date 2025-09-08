import { FastifyInstance } from "fastify";
import { z } from "zod";
import { FileSystemManifest } from "../../../src/adapters/fs-manifest.js";
import { randomUUID } from "node:crypto";
import { PromptRowSchema } from "../../../src/types.js";

/**
 * Save prompts route for exporting prompt arrays as JSONL
 * POST /ui/save-prompts - save prompts array to JSONL file
 */
export default async function savePromptsRoutes(fastify: FastifyInstance) {
  const REQUEST_SCHEMA = z.object({
    prompts: z.array(PromptRowSchema).min(1).max(10000),
    outputPath: z.string().default('./artifacts/prompts.jsonl'),
    format: z.enum(['jsonl', 'csv']).default('jsonl'),
  }).strict();

  fastify.post('/ui/save-prompts', async (request, reply) => {
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

      const { prompts, outputPath, format } = validation.data;

      // Security: validate file path (prevent traversal)
      if (outputPath.includes('..') || outputPath.includes('~')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid file path',
          detail: 'File path must not contain path traversal sequences',
          status: 400,
          instance: randomUUID(),
        });
      }

      fastify.log.info({
        outputPath,
        format,
        promptCount: prompts.length,
      }, 'Starting prompt save via API');

      const manifest = new FileSystemManifest();

      if (format === 'jsonl') {
        // Write prompts as JSONL (one JSON object per line)
        const jsonlContent = prompts
          .map(prompt => JSON.stringify(prompt))
          .join('\n') + '\n';
        
        await manifest.writeAtomic(outputPath, jsonlContent);
      } else if (format === 'csv') {
        // Convert to CSV format
        const csvHeader = 'sourceImage,prompt,tags,seed,strength\n';
        const csvRows = prompts.map(prompt => {
          const tags = JSON.stringify(prompt.tags);
          const seed = prompt.seed || '';
          const strength = prompt.strength || '';
          // Escape quotes in prompt and sourceImage
          const escapedPrompt = prompt.prompt.replace(/"/g, '""');
          const escapedSourceImage = prompt.sourceImage.replace(/"/g, '""');
          return `"${escapedSourceImage}","${escapedPrompt}","${tags}",${seed},${strength}`;
        }).join('\n') + '\n';
        
        await manifest.writeAtomic(outputPath, csvHeader + csvRows);
      }

      // Group by source image for statistics
      const promptsBySource = prompts.reduce((acc, prompt) => {
        acc[prompt.sourceImage] = (acc[prompt.sourceImage] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Record success in manifest
      await manifest.recordSuccess(
        'save-prompts',
        `${prompts.length} prompts`,
        outputPath,
        {
          format,
          promptCount: prompts.length,
          sourceImages: Object.keys(promptsBySource).length,
          avgPerImage: Math.round(prompts.length / Object.keys(promptsBySource).length * 100) / 100,
        }
      );

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const response = {
        success: true,
        outputPath,
        format,
        saved: prompts.length,
        sourceImages: Object.keys(promptsBySource).length,
        avgPerImage: Math.round(prompts.length / Object.keys(promptsBySource).length * 100) / 100,
        duration,
        promptsBySource,
      };

      fastify.log.info({
        outputPath,
        format,
        saved: prompts.length,
        sourceImages: Object.keys(promptsBySource).length,
        duration,
      }, 'Prompt save completed via API');

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Prompt save failed via API');

      // Record failure in manifest
      const manifest = new FileSystemManifest();
      await manifest.recordProblem('save-prompts', 'request body', {
        type: 'about:blank',
        title: 'Save prompts failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
        instance: randomUUID()
      });

      // Check if it's a specific known error
      if (error instanceof Error) {
        if (error.message.includes('EACCES')) {
          return reply.code(403).send({
            type: 'about:blank',
            title: 'Permission denied',
            detail: 'Cannot write to the specified output path. Please check file permissions.',
            status: 403,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('ENOSPC')) {
          return reply.code(507).send({
            type: 'about:blank',
            title: 'Insufficient storage',
            detail: 'Not enough disk space to save the prompts file.',
            status: 507,
            instance: randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Save failed',
        detail: 'An error occurred while saving prompts. Please check the server logs.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info('Save prompts route registered at POST /ui/save-prompts');
}