import "dotenv/config";
import fastify from "fastify";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { loadEnv } from "./config/env.js";
import { log } from "./logger.js";
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
  }
}

async function main() {
  const env = loadEnv();
  const app = fastify({ logger: log });
  
  // Attach config for plugins
  app.decorate("config", env);
  
  // Register plugins
  await app.register(sensible);
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024, // 15MB max per file
      files: 500, // max 500 files per request
    }
  });
  
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