import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { existsSync } from "node:fs";

/**
 * Result fetching route for completed jobs
 * GET /ui/fetch?jobId=uuid - fetch job results and generated images
 */
export default async function fetchRoutes(fastify: FastifyInstance) {
  const QUERY_SCHEMA = z.object({
    jobId: z.string().uuid(),
    format: z.enum(['json', 'gallery', 'download']).default('json'),
    // Coerce strings to numbers since query params arrive as strings
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict();

  fastify.get('/ui/fetch', async (request, reply) => {
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

      const { jobId, format, limit, offset } = validation.data;

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
          detail: `No job found with ID ${jobId}. The job may have expired or been cleaned up.`,
          status: 404,
          instance: randomUUID(),
        });
      }

      fastify.log.info({
        jobId,
        status: job.status,
        format,
      }, 'Fetching job results via API');

      // Check if job is completed
      if (job.status !== 'completed') {
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Job not completed',
          detail: `Job ${jobId} is in status '${job.status}'. Results are only available for completed jobs.`,
          status: 409,
          instance: randomUUID(),
        });
      }

      // Determine output directory (default based on provider)
      const outputDir = './outputs'; // Default from submit workflow
      const jobOutputDir = join(outputDir, jobId);

      // Try to find results in various locations
      let resultFiles: string[] = [];
      let resultStats: any[] = [];

      // Check job-specific directory first
      if (existsSync(jobOutputDir)) {
        resultFiles = await findImageFiles(jobOutputDir);
      }

      // Fallback to general outputs directory
      if (resultFiles.length === 0 && existsSync(outputDir)) {
        const allFiles = await findImageFiles(outputDir);
        // Filter by timestamp if possible - get recent files
        const jobStartTime = job.startTime.getTime();
        const potentialFiles: Array<{path: string, mtime: number}> = [];
        
        for (const file of allFiles) {
          try {
            const stats = await stat(file);
            if (stats.mtime.getTime() > jobStartTime) {
              potentialFiles.push({ path: file, mtime: stats.mtime.getTime() });
            }
          } catch (error) {
            // Skip files we can't stat
          }
        }
        
        // Sort by modification time (newest first) and take files from around job time
        potentialFiles.sort((a, b) => b.mtime - a.mtime);
        resultFiles = potentialFiles.slice(0, job.estimatedImages || 50).map(f => f.path);
      }

      // Get file stats for all result files
      for (const file of resultFiles) {
        try {
          const stats = await stat(file);
          resultStats.push({
            path: file,
            name: basename(file),
            size: stats.size,
            modified: stats.mtime.toISOString(),
            type: getImageType(file),
          });
        } catch (error) {
          fastify.log.warn({ file, error }, 'Could not stat result file');
        }
      }

      // Apply pagination if requested
      const totalResults = resultStats.length;
      const startIndex = offset || 0;
      const endIndex = limit ? Math.min(startIndex + limit, totalResults) : totalResults;
      const paginatedResults = resultStats.slice(startIndex, endIndex);

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      // Build response based on format
      if (format === 'gallery') {
        // Return gallery-friendly format with image data
        const galleryItems = await Promise.all(
          paginatedResults.map(async (item) => {
            try {
              const imageBuffer = await readFile(item.path);
              const base64Data = imageBuffer.toString('base64');
              const mimeType = getMimeType(item.path);
              
              return {
                id: randomUUID(),
                name: item.name,
                size: item.size,
                modified: item.modified,
                type: item.type,
                dataUrl: `data:${mimeType};base64,${base64Data}`,
                downloadUrl: `/ui/download/${jobId}/${encodeURIComponent(item.name)}`,
              };
            } catch (error) {
              fastify.log.warn({ path: item.path, error }, 'Could not read image for gallery');
              return {
                id: randomUUID(),
                name: item.name,
                size: item.size,
                modified: item.modified,
                type: item.type,
                error: 'Could not load image data',
                downloadUrl: `/ui/download/${jobId}/${encodeURIComponent(item.name)}`,
              };
            }
          })
        );

        return reply.send({
          jobId,
          status: 'completed',
          format: 'gallery',
          results: {
            total: totalResults,
            offset: startIndex,
            limit: limit || totalResults,
            items: galleryItems,
          },
          job: {
            provider: job.provider,
            prompts: job.promptCount,
            estimatedImages: job.estimatedImages,
            startTime: job.startTime.toISOString(),
            endTime: job.endTime?.toISOString(),
            duration: job.endTime ? 
              `${Math.round((job.endTime.getTime() - job.startTime.getTime()) / 1000)}s` : 
              undefined,
          },
          actions: {
            downloadAll: `/ui/download/${jobId}/all.zip`,
            nextPage: limit && endIndex < totalResults ? 
              `/ui/fetch?jobId=${jobId}&format=gallery&limit=${limit}&offset=${endIndex}` : 
              undefined,
          },
          duration,
        });
      } else {
        // Return JSON metadata format
        return reply.send({
          jobId,
          status: 'completed',
          format: 'json',
          results: {
            total: totalResults,
            offset: startIndex,
            limit: limit || totalResults,
            files: paginatedResults,
          },
          job: {
            provider: job.provider,
            prompts: job.promptCount,
            estimatedImages: job.estimatedImages,
            startTime: job.startTime.toISOString(),
            endTime: job.endTime?.toISOString(),
            duration: job.endTime ? 
              `${Math.round((job.endTime.getTime() - job.startTime.getTime()) / 1000)}s` : 
              undefined,
          },
          summary: {
            totalSize: paginatedResults.reduce((sum, item) => sum + item.size, 0),
            byType: summarizeByType(paginatedResults),
          },
          actions: {
            gallery: `/ui/fetch?jobId=${jobId}&format=gallery`,
            downloadAll: `/ui/download/${jobId}/all.zip`,
            nextPage: limit && endIndex < totalResults ? 
              `/ui/fetch?jobId=${jobId}&limit=${limit}&offset=${endIndex}` : 
              undefined,
          },
          duration,
        });
      }

    } catch (error) {
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      
      fastify.log.error({ 
        error: error instanceof Error ? error.message : error,
        duration,
      }, 'Result fetching failed via API');

      // Check for specific known errors
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          return reply.code(404).send({
            type: 'about:blank',
            title: 'Results not found',
            detail: 'Job completed but no result files could be found. They may have been moved or deleted.',
            status: 404,
            instance: randomUUID(),
          });
        }

        if (error.message.includes('EACCES')) {
          return reply.code(403).send({
            type: 'about:blank',
            title: 'Permission denied',
            detail: 'Cannot access the result files. Please check permissions.',
            status: 403,
            instance: randomUUID(),
          });
        }
      }

      // Generic error response
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Fetch failed',
        detail: 'An error occurred while fetching job results. Please try again.',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info('Fetch route registered at GET /ui/fetch');
}

/**
 * Find all image files in a directory
 */
async function findImageFiles(dir: string): Promise<string[]> {
  const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);
      if (stats.isFile() && supportedExtensions.includes(extname(entry).toLowerCase())) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return files;
}

/**
 * Get image type from file extension
 */
function getImageType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'JPEG';
    case '.png': return 'PNG';
    case '.webp': return 'WebP';
    case '.gif': return 'GIF';
    default: return 'Unknown';
  }
}

/**
 * Get MIME type for image
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

/**
 * Summarize files by type
 */
function summarizeByType(files: any[]): Record<string, {count: number, totalSize: number}> {
  const summary: Record<string, {count: number, totalSize: number}> = {};
  
  for (const file of files) {
    const type = file.type;
    if (!summary[type]) {
      summary[type] = { count: 0, totalSize: 0 };
    }
    summary[type].count++;
    summary[type].totalSize += file.size;
  }
  
  return summary;
}