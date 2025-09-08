import { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Serve static assets for the React GUI at /app/*
 * In production, serves built assets. In development, could proxy to Vite dev server.
 */
export default async function staticRoutes(fastify: FastifyInstance) {
  const isProd = fastify.config.NODE_ENV === 'production';
  
  // Path to GUI build directory (relative to proxy root)
  const buildPath = join(__dirname, '../../..', 'apps/gui/dist');
  
  // MIME type mapping for common web assets
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  const getMimeType = (filePath: string): string => {
    const ext = extname(filePath).toLowerCase();
    return mimeTypes[ext] || 'application/octet-stream';
  };

  // Security headers for static content
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  // Serve static assets under /app/*
  fastify.get('/app/*', async (request, reply) => {
    try {
      // Extract path after /app/
      const requestPath = request.url.replace(/^\/app\/?/, '') || 'index.html';
      
      // Security: prevent path traversal
      if (requestPath.includes('..') || requestPath.includes('//')) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid path',
          detail: 'Path traversal attempts are not allowed',
          status: 400,
          instance: randomUUID(),
        });
      }

      const filePath = join(buildPath, requestPath);
      
      // Check if file exists and is within build directory
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        throw new Error('Not a file');
      }

      // Security: ensure file is within build directory (additional check)
      const normalizedBuildPath = await import('node:fs').then(fs => 
        fs.promises.realpath(buildPath)
      );
      const normalizedFilePath = await import('node:fs').then(fs => 
        fs.promises.realpath(filePath)
      );
      
      if (!normalizedFilePath.startsWith(normalizedBuildPath)) {
        return reply.code(403).send({
          type: 'about:blank',
          title: 'Forbidden',
          detail: 'Access to this path is not allowed',
          status: 403,
          instance: randomUUID(),
        });
      }

      // Read and serve file
      const content = await readFile(filePath);
      const mimeType = getMimeType(filePath);
      
      // Set appropriate headers
      reply.headers({
        ...securityHeaders,
        'Content-Type': mimeType,
        'Cache-Control': filePath.endsWith('.html') 
          ? 'no-cache, no-store, must-revalidate' // No cache for HTML
          : 'public, max-age=31536000', // 1 year cache for assets
      });

      return reply.send(content);

    } catch (error) {
      // File not found or other error - serve index.html for SPA routing
      try {
        const indexPath = join(buildPath, 'index.html');
        const indexContent = await readFile(indexPath, 'utf-8');
        
        reply.headers({
          ...securityHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });

        return reply.send(indexContent);
      } catch (indexError) {
        fastify.log.error({ error: indexError, buildPath }, 'Failed to serve index.html fallback');
        return reply.code(404).send({
          type: 'about:blank',
          title: 'GUI not available',
          detail: isProd 
            ? 'GUI assets not found. Please build the frontend first.' 
            : 'GUI in development mode - check if Vite dev server is running',
          status: 404,
          instance: randomUUID(),
        });
      }
    }
  });

  // Redirect /app to /app/ for consistency
  fastify.get('/app', async (request, reply) => {
    return reply.redirect(301, '/app/');
  });

  fastify.log.info({ buildPath }, 'Static GUI routes registered at /app/*');
}