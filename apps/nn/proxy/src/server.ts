import "dotenv/config";
import fastify from "fastify";
import sensible from "@fastify/sensible";
import { loadEnv } from "./config/env.js";
import { log } from "./logger.js";
import batchRoutes from "./routes/batch.js";

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
  await app.register(batchRoutes);

  // Start server
  await app.listen({ port: env.PORT, host: env.BIND_HOST });
  log.info({ port: env.PORT, host: env.BIND_HOST }, "batch relay listening");
}

main().catch((e) => {
  log.error({ err: e }, "server start failed");
  process.exit(1);
});