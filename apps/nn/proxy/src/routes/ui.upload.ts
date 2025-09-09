import { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";

/**
 * Upload route for image files with comprehensive security validation
 * POST /ui/upload - multipart file upload to ./images/ directory
 */
export default async function uploadRoutes(fastify: FastifyInstance) {
  const UPLOAD_DIR = './images';
  const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
  const MAX_FILES = 500;
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Rate limiting: max 10 requests per minute per IP
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  const RATE_LIMIT = 10;
  const RATE_WINDOW = 60 * 1000; // 1 minute

  const checkRateLimit = (ip: string): boolean => {
    const now = Date.now();
    const existing = rateLimitMap.get(ip);
    
    if (!existing || now > existing.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
      return true;
    }
    
    if (existing.count >= RATE_LIMIT) {
      return false;
    }
    
    existing.count++;
    return true;
  };

  // Ensure upload directory exists
  await mkdir(UPLOAD_DIR, { recursive: true });

  fastify.post('/ui/upload', {
    preHandler: fastify.rateLimit ? undefined : async (request, reply) => {
      // Manual rate limiting if fastify rate limit plugin not available
      const clientIp = request.ip || 'unknown';
      if (!checkRateLimit(clientIp)) {
        return reply.code(429).send({
          type: 'about:blank',
          title: 'Too Many Requests',
          detail: `Rate limit exceeded. Max ${RATE_LIMIT} requests per minute.`,
          status: 429,
          instance: randomUUID(),
        });
      }
    }
  }, async (request, reply) => {
    try {
      // Check if request is multipart
      if (!request.isMultipart()) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid request',
          detail: 'Request must be multipart/form-data for file upload',
          status: 400,
          instance: randomUUID(),
        });
      }

      const files: Array<{ filename: string; path: string; size: number }> = [];
      const warnings: string[] = [];
      let fileCount = 0;
      let clearExisting = false;

      // Check for clearExisting in query params or body
      // Can be passed as query param: /ui/upload?clearExisting=true
      const queryParams = request.query as any;
      if (queryParams && (queryParams.clearExisting === 'true' || queryParams.clearExisting === true)) {
        clearExisting = true;
        fastify.log.info({ clearExisting }, 'Clear existing flag detected from query params');
      }

      // Clear existing images if requested (before processing new uploads)
      if (clearExisting) {
        try {
          const existingFiles = await readdir(UPLOAD_DIR);
          let clearedCount = 0;
          
          for (const file of existingFiles) {
            if (ALLOWED_EXTENSIONS.some(ext => file.endsWith(ext))) {
              await unlink(join(UPLOAD_DIR, file));
              clearedCount++;
            }
          }
          
          if (clearedCount > 0) {
            fastify.log.info({ clearedCount }, 'Cleared existing image files');
            warnings.push(`Cleared ${clearedCount} existing image(s) from upload directory`);
          }
        } catch (clearError) {
          fastify.log.warn({ 
            error: clearError instanceof Error ? clearError.message : String(clearError) 
          }, 'Failed to clear existing files');
          warnings.push('Could not clear existing files');
        }
      }

      // Process multipart files
      const parts = request.files();
      
      for await (const part of parts) {
        fileCount++;
        
        // Check file count limit
        if (fileCount > MAX_FILES) {
          warnings.push(`Exceeded maximum file count (${MAX_FILES}). Additional files ignored.`);
          break;
        }

        if (!part.filename) {
          warnings.push('Skipped file without filename');
          continue;
        }

        // Security: validate filename
        const originalFilename = part.filename;
        if (originalFilename.includes('..') || originalFilename.includes('/') || originalFilename.includes('\\')) {
          warnings.push(`Skipped file with invalid name: ${originalFilename}`);
          continue;
        }

        // Validate file extension
        const ext = extname(originalFilename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          warnings.push(`Skipped file with unsupported extension: ${originalFilename}`);
          continue;
        }

        // Validate MIME type
        if (!ALLOWED_MIME_TYPES.includes(part.mimetype)) {
          warnings.push(`Skipped file with unsupported MIME type: ${originalFilename} (${part.mimetype})`);
          continue;
        }

        // Generate safe filename with hash prefix to avoid conflicts
        const hash = createHash('md5').update(originalFilename + Date.now()).digest('hex').slice(0, 8);
        const safeFilename = `${hash}_${basename(originalFilename)}`;
        const filepath = join(UPLOAD_DIR, safeFilename);

        try {
          // Stream file to disk with size checking
          const writeStream = createWriteStream(filepath);
          let bytesWritten = 0;
          let sizeExceeded = false;

          // Monitor file size during streaming
          // part.file is the actual stream in Fastify multipart
          const fileStream = part.file || part;
          
          fileStream.on('data', (chunk: Buffer) => {
            bytesWritten += chunk.length;
            if (bytesWritten > MAX_FILE_SIZE && !sizeExceeded) {
              sizeExceeded = true;
              writeStream.destroy();
              fileStream.destroy();
            }
          });

          await pipeline(fileStream, writeStream).catch((err) => {
            if (sizeExceeded) {
              throw new Error(`File size exceeds limit (${MAX_FILE_SIZE} bytes): ${originalFilename}`);
            }
            throw err;
          });

          // Double-check final file size
          if (bytesWritten > MAX_FILE_SIZE) {
            // Clean up oversized file
            await import('node:fs/promises').then(fs => fs.unlink(filepath).catch(() => {}));
            warnings.push(`Skipped oversized file: ${originalFilename} (${bytesWritten} bytes)`);
            continue;
          }

          files.push({
            filename: originalFilename,
            path: filepath,
            size: bytesWritten,
          });

          fastify.log.info({
            originalFilename,
            safeFilename,
            size: bytesWritten,
            mimetype: part.mimetype,
          }, 'File uploaded successfully');

        } catch (streamError) {
          // Clean up failed upload
          await import('node:fs/promises').then(fs => fs.unlink(filepath).catch(() => {}));
          warnings.push(`Failed to upload file: ${originalFilename}`);
          fastify.log.warn({ 
            error: streamError instanceof Error ? streamError.message : String(streamError),
            stack: streamError instanceof Error ? streamError.stack : undefined,
            filename: originalFilename 
          }, 'File upload failed');
        }
      }

      // Return response
      const response = {
        uploaded: files.length,
        files: files.map(({ filename, path, size }) => ({ filename, path, size })),
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      fastify.log.info({
        uploaded: files.length,
        warnings: warnings.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
      }, 'Upload batch completed');

      return reply.send(response);

    } catch (error) {
      fastify.log.error({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, 'Upload request failed');
      
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Upload failed',
        detail: error instanceof Error ? error.message : 'An error occurred while processing the file upload',
        status: 500,
        instance: randomUUID(),
      });
    }
  });

  fastify.log.info({ 
    uploadDir: UPLOAD_DIR,
    maxFileSize: MAX_FILE_SIZE,
    maxFiles: MAX_FILES,
    allowedExtensions: ALLOWED_EXTENSIONS,
  }, 'Upload route registered at POST /ui/upload');
}