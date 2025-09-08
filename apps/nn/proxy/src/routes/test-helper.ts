import fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import uploadRoutes from './ui.upload.js';
import analyzeRoutes from './ui.analyze.js';
import type { FastifyInstance } from 'fastify';

// Mock environment for testing
const mockEnv = {
  NODE_ENV: 'test' as const,
  PORT: 8787,
  BIND_HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
};

/**
 * Build a Fastify app instance for testing
 */
export async function build(): Promise<FastifyInstance> {
  const app = fastify({ 
    logger: false, // Disable logging in tests
  });

  // Attach mock config
  app.decorate('config', mockEnv);

  // Register plugins
  await app.register(sensible);
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024, // 15MB max per file
      files: 500, // max 500 files per request
    }
  });

  // Register routes
  await app.register(uploadRoutes);
  await app.register(analyzeRoutes);

  return app;
}