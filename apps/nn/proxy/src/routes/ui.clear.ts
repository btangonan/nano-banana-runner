import type { FastifyInstance } from "fastify";
import { rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/**
 * Clear images route for starting a new analysis session
 * POST /ui/clear-images - removes all images from ./images/ directory
 */
export default async function uiClearRoutes(app: FastifyInstance) {
  // Keep this in sync with upload/analyze directory
  const UPLOAD_DIR = "./images";

  app.post("/ui/clear-images", {
    schema: {
      summary: "Start a new analysis session by clearing uploaded images",
      tags: ["UI"],
      response: {
        200: {
          type: "object",
          properties: { 
            cleared: { type: "boolean" },
            message: { type: "string" }
          },
          required: ["cleared"]
        },
        500: {
          type: "object",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "number" },
            detail: { type: "string" },
            instance: { type: "string" }
          }
        }
      }
    }
  }, async (_request, reply) => {
    try {
      // Idempotent clear - 'force' handles missing directory gracefully
      await rm(UPLOAD_DIR, { recursive: true, force: true });
      await mkdir(UPLOAD_DIR, { recursive: true });
      
      app.log.info({ 
        route: "ui.clear-images", 
        directory: UPLOAD_DIR,
        cleared: true 
      }, "Session cleared - images directory reset");
      
      return reply.send({ 
        cleared: true,
        message: "New session started - previous images cleared"
      });
    } catch (err: any) {
      app.log.error({ 
        route: "ui.clear-images", 
        error: err?.message,
        directory: UPLOAD_DIR
      }, "Failed to clear images directory");
      
      return reply
        .code(500)
        .type("application/problem+json")
        .send({
          type: "about:blank",
          title: "Failed to clear images",
          status: 500,
          detail: err?.message ?? "Could not clear the images directory",
          instance: randomUUID()
        });
    }
  });

  app.log.info("Clear images route registered at POST /ui/clear-images");
}