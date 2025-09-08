import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { preflight, loadBudgetsFromEnv } from "../../../src/workflows/preflight.js";
import { readFile } from "node:fs/promises";
import { PromptRow, PromptRowSchema } from "../../../src/types.js";
import { ReferencePack } from "../../../src/types/refs.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Preflight cost estimation and validation route
 * POST /ui/preflight - validate prompts and estimate costs
 */
export default async function preflightRoutes(fastify: FastifyInstance) {
  const REQUEST_SCHEMA = z.object({
    promptsPath: z.string().default('./artifacts/prompts.jsonl'),
    styleDir: z.string().optional(),
    referencePack: z.string().optional(), // Path to refs.json/yaml
    provider: z.enum(['gemini-batch', 'vertex-ai']).default('gemini-batch'),
    variants: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  }).strict();

  fastify.post('/ui/preflight', async (request, reply) => {
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

      const { promptsPath, styleDir, referencePack, provider, variants } = validation.data;

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

      if (styleDir && (styleDir.includes('..') || styleDir.includes('~'))) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid directory path',
          detail: 'Style directory path must not contain path traversal sequences',
          status: 400,
          instance: randomUUID(),
        });
      }

      fastify.log.info({
        promptsPath,
        styleDir,
        referencePack,
        provider,
        variants,
      }, 'Starting preflight validation via API');

      // Check if prompts file exists
      if (!existsSync(promptsPath)) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Prompts file not found',
          detail: `The prompts file at ${promptsPath} does not exist. Please generate prompts first using the remix workflow.`,
          status: 404,
          instance: randomUUID(),
        });
      }

      // Load and validate prompts
      const promptsContent = await readFile(promptsPath, 'utf-8');
      const lines = promptsContent.trim().split('\n').filter(line => line.trim());
      
      let rows: PromptRow[] = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          const validated = PromptRowSchema.parse(parsed);
          rows.push(validated);
        } catch (error) {
          return reply.code(400).send({
            type: 'about:blank',
            title: 'Invalid prompt format',
            detail: `Line ${i + 1} in prompts file is invalid: ${error instanceof Error ? error.message : 'Parse error'}`,
            status: 400,
            instance: randomUUID(),
          });
        }
      }

      if (rows.length === 0) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'No valid prompts',
          detail: 'The prompts file contains no valid prompt entries.',
          status: 400,
          instance: randomUUID(),
        });
      }

      // Build reference pack if style directory provided
      let pack: ReferencePack | undefined = undefined;
      if (styleDir && existsSync(styleDir)) {
        // Simple style-only pack from directory
        const styleFiles = await findFiles(styleDir, ['.jpg', '.jpeg', '.png', '.webp']);
        if (styleFiles.length > 0) {
          pack = {
            version: '1.0',
            style: styleFiles.map(path => ({ path, weight: 1.0 })),
            metadata: {
              created: new Date().toISOString(),
              description: `Auto-generated from ${styleDir}`,
            }
          };
        }
      }

      // Load reference pack from file if specified
      if (referencePack && existsSync(referencePack)) {
        try {
          const packContent = await readFile(referencePack, 'utf-8');
          const parsed = JSON.parse(packContent);
          // TODO: Add proper ReferencePack validation
          pack = parsed;
        } catch (error) {
          fastify.log.warn({ referencePack, error }, 'Failed to load reference pack, ignoring');
        }
      }

      // Load budget configuration from environment
      const budgets = loadBudgetsFromEnv();

      // Run preflight validation
      const result = await preflight(rows, pack, budgets);

      // Calculate cost estimation based on provider
      const totalImages = rows.length * variants;
      let costPerImage = 0.0025; // Default fallback
      
      if (provider === 'gemini-batch') {
        costPerImage = 0.000125; // $0.000125 per image for Gemini Batch
      } else if (provider === 'vertex-ai') {
        costPerImage = 0.0025; // $0.0025 per image for Vertex AI
      }

      const estimatedCost = totalImages * costPerImage;
      const estimatedTimeMinutes = Math.ceil(totalImages / (provider === 'gemini-batch' ? 30 : 10)); // Rough estimates

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const response = {
        validation: {
          ok: result.ok,
          promptCount: rows.length,
          chunks: result.chunks,
          uniqueRefs: result.uniqueRefs,
          problems: result.problems || [],
        },
        costEstimate: {
          provider,
          variants,
          totalImages,
          costPerImage,
          estimatedCost: parseFloat(estimatedCost.toFixed(6)),
          estimatedTime: `${estimatedTimeMinutes}m`,
          currency: 'USD',
        },
        resources: {
          bytesBeforeCompression: result.bytes.before,
          bytesAfterCompression: result.bytes.after,
          compressionRatio: result.bytes.before > 0 ? 
            parseFloat((result.bytes.after / result.bytes.before).toFixed(2)) : 1,
          referencesFound: pack?.style?.length || 0,
        },
        recommendations: generateRecommendations(result, totalImages, estimatedCost),
        duration,
      };

      fastify.log.info({
        promptCount: rows.length,
        totalImages,
        estimatedCost,
        provider,
        duration,
        validationOk: result.ok,
      }, 'Preflight validation completed via API');

      return reply.send(response);

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Preflight validation failed via API');

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
            detail: 'Cannot access the required files. Please check file permissions.',
            status: 403,
            instance: randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Preflight failed',
        detail: 'An error occurred during preflight validation. Please check the server logs.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info('Preflight route registered at POST /ui/preflight');
}

/**
 * Generate recommendations based on preflight results
 */
function generateRecommendations(
  result: any, 
  totalImages: number, 
  estimatedCost: number
): string[] {
  const recommendations: string[] = [];

  if (!result.ok) {
    recommendations.push("⚠️ Validation failed - please address issues before submission");
  }

  if (totalImages > 100) {
    recommendations.push("📊 Large batch detected - consider running a smaller test first");
  }

  if (estimatedCost > 10) {
    recommendations.push("💰 High cost estimate - consider reducing variants or prompt count");
  }

  if (result.chunks > 1) {
    recommendations.push(`📦 Batch will be split into ${result.chunks} chunks for processing`);
  }

  if (result.bytes.before > 50 * 1024 * 1024) {
    recommendations.push("🗜️ Large reference images - compression is recommended");
  }

  if (recommendations.length === 0) {
    recommendations.push("✅ Ready for submission - all validations passed");
  }

  return recommendations;
}

/**
 * Find files in directory with given extensions
 */
async function findFiles(dir: string, extensions: string[]): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);
      if (stats.isFile() && extensions.some(ext => entry.toLowerCase().endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return files;
}