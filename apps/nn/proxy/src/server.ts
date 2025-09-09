import "dotenv/config";
import fastify from "fastify";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { loadEnv } from "./config/env.js";
import { log } from "./logger.js";
import { metrics, registerMetrics } from "./metrics.js";
import batchRoutes from "./routes/batch.js";
import staticRoutes from "./routes/ui.static.js";
import uploadRoutes from "./routes/ui.upload.js";
import analyzeRoutes from "./routes/ui.analyze.js";
import remixRoutes from "./routes/ui.remix.js";
import savePromptsRoutes from "./routes/ui.savePrompts.js";
import preflightRoutes from "./routes/ui.preflight.js";
import submitRoutes from "./routes/ui.submit.js";
import pollRoutes from "./routes/ui.poll.js";
import fetchRoutes from "./routes/ui.fetch.js";

declare module "fastify" {
  interface FastifyInstance {
    config: import("./config/env.js").Env;
    jobs: Map<string, any>;
  }
}

async function main() {
  const env = loadEnv();
  const app = fastify({ logger: log });
  
  // Attach config for plugins
  app.decorate("config", env);
  
  // Initialize jobs Map for tracking async operations
  const jobs = new Map<string, any>();
  app.decorate("jobs", jobs);
  
  // Register plugins
  await app.register(sensible);
  
  // Configure rate limiting
  if (env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: env.RATE_LIMIT_GLOBAL_MAX,
      timeWindow: '1 minute',
      hook: 'preHandler',
      skipOnError: false,
      keyGenerator: (req) => {
        // Use X-Forwarded-For if behind proxy, otherwise use IP
        return req.headers['x-forwarded-for'] as string || req.ip;
      },
      errorResponseBuilder: (req, context) => ({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit exceeded. Max ${context.max} requests per ${context.after}`,
        instance: req.url
      })
    });
    
    // Route-specific limits for batch operations
    app.addHook('onRoute', (routeOptions) => {
      if (routeOptions.url === '/batch/submit') {
        routeOptions.config = {
          ...routeOptions.config,
          rateLimit: {
            max: env.RATE_LIMIT_BATCH_MAX,
            timeWindow: '5 minutes'
          }
        };
      }
      // Exempt health check from rate limiting
      if (routeOptions.url === '/healthz') {
        routeOptions.config = {
          ...routeOptions.config,
          rateLimit: false
        };
      }
    });
  }
  
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024, // 15MB max per file
      files: 500, // max 500 files per request
    }
  });
  
  // Configure CORS
  const allowedOrigins = env.ALLOWED_ORIGINS 
    ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'http://localhost:5174', 
        'http://127.0.0.1:5174',
        'http://localhost:8787',  // Allow proxy's own origin
        'http://127.0.0.1:8787'   // Allow proxy's own origin
      ]; // Default to local dev
    
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g., mobile apps, Postman)
      if (!origin) return cb(null, true);
      
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
  
  // Register metrics collection
  registerMetrics(app, metrics);
  
  // Register routes
  await app.register(batchRoutes);
  await app.register(staticRoutes);
  await app.register(uploadRoutes);
  await app.register(analyzeRoutes);
  await app.register(remixRoutes);
  await app.register(savePromptsRoutes);
  await app.register(preflightRoutes);
  await app.register(submitRoutes);
  await app.register(pollRoutes);
  await app.register(fetchRoutes);

  // Start server
  await app.listen({ port: env.PORT, host: env.BIND_HOST });
  log.info({ port: env.PORT, host: env.BIND_HOST }, "batch relay listening");
}

main().catch((e) => {
  log.error({ err: e }, "server start failed");
  process.exit(1);
});