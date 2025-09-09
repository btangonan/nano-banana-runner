import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GeminiBatchClient } from "../clients/geminiBatch.js";

const SubmitSchema = z.object({
  jobId: z.string().optional(),
  rows: z.array(z.object({
    prompt: z.string(),
    sourceImage: z.string().optional(),
    seed: z.number().optional(),
    tags: z.array(z.string()).optional()
  })).min(1),
  variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  styleOnly: z.literal(true),
  styleRefs: z.array(z.string())
}).strict();

export default async function batchRoutes(app: FastifyInstance) {
  const apiKey = app.config.GEMINI_BATCH_API_KEY;
  
  if (!apiKey && app.config.NODE_ENV !== "development") {
    app.log.warn("No GEMINI_BATCH_API_KEY set. In production, mount a Secret Manager fetch.");
  }
  
  const client = new GeminiBatchClient(apiKey ?? "DEV-KEY");

  // Submit batch job (with Direct Mode support)
  app.post("/batch/submit", {
    config: {
      // Apply body size limit based on Direct Mode
      bodyLimit: app.config.DIRECT_MAX_BODY_BYTES
    }
  }, async (req, reply) => {
    const body = req.body as any;
    
    // Direct Mode detection
    const isDirect = app.config.NN_ENABLE_DIRECT_MODE && 
                     body?.rows && 
                     Array.isArray(body.rows);
    
    // Apply guardrails for Direct Mode
    if (isDirect) {
      // Validation caps (without new schemas)
      if (body.rows.length > app.config.DIRECT_MAX_ROWS) {
        return reply.code(413).send({
          type: "about:blank",
          title: "Too many rows",
          detail: `Maximum ${app.config.DIRECT_MAX_ROWS} rows allowed in direct mode`,
          status: 413
        });
      }
      
      // Validate each row
      for (let i = 0; i < body.rows.length; i++) {
        const row = body.rows[i];
        
        // Check prompt length
        if (!row.prompt || row.prompt.length > app.config.DIRECT_MAX_PROMPT_LEN) {
          return reply.code(400).send({
            type: "about:blank",
            title: "Prompt too long",
            detail: `Row ${i}: Maximum ${app.config.DIRECT_MAX_PROMPT_LEN} characters per prompt`,
            status: 400
          });
        }
        
        // Check tags
        if (row.tags && row.tags.length > app.config.DIRECT_MAX_TAGS) {
          return reply.code(400).send({
            type: "about:blank",
            title: "Too many tags",
            detail: `Row ${i}: Maximum ${app.config.DIRECT_MAX_TAGS} tags per row`,
            status: 400
          });
        }
        
        // Check tag length
        if (row.tags) {
          for (const tag of row.tags) {
            if (tag.length > app.config.DIRECT_MAX_TAG_LEN) {
              return reply.code(400).send({
                type: "about:blank",
                title: "Tag too long",
                detail: `Row ${i}: Maximum ${app.config.DIRECT_MAX_TAG_LEN} characters per tag`,
                status: 400
              });
            }
          }
        }
      }
      
      // Force style-only guard for Direct Mode
      body.styleOnly = true;
      
      // Log Direct Mode usage (with redacted prompt preview)
      app.log.info({ 
        mode: "direct",
        rows: body.rows.length,
        firstPromptPreview: body.rows[0]?.prompt?.substring(0, 120) + "..."
      }, "Direct mode batch submission");
    }
    
    // Continue with existing validation
    const parsed = SubmitSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ 
        type: "about:blank", 
        title: "Invalid body", 
        detail: parsed.error.message, 
        status: 400 
      });
    }
    
    try {
      const res = await client.submit(parsed.data);
      app.log.info({ 
        jobId: res.jobId, 
        estCount: res.estCount,
        mode: isDirect ? "direct" : "remix"
      }, "Batch job submitted");
      return reply.send(res);
    } catch (error: any) {
      app.log.error({ 
        error: error.message,
        mode: isDirect ? "direct" : "remix"
      }, "Batch submit failed");
      return reply.code(500).send({
        type: "about:blank",
        title: "Batch submit failed",
        detail: error.message,
        status: 500
      });
    }
  });

  // Poll job status
  app.get("/batch/:id", async (req, reply) => {
    const id = z.string().parse((req.params as any).id);
    
    try {
      const res = await client.poll(id);
      return reply.send(res);
    } catch (error: any) {
      app.log.error({ jobId: id, error: error.message }, "Batch poll failed");
      return reply.code(500).send({
        type: "about:blank",
        title: "Batch poll failed",
        detail: error.message,
        status: 500
      });
    }
  });

  // Fetch job results
  app.get("/batch/:id/results", async (req, reply) => {
    const id = z.string().parse((req.params as any).id);
    
    try {
      const res = await client.fetch(id);
      app.log.info({ jobId: id, results: res.results.length, problems: res.problems.length }, "Batch results fetched");
      return reply.send(res);
    } catch (error: any) {
      app.log.error({ jobId: id, error: error.message }, "Batch fetch failed");
      return reply.code(500).send({
        type: "about:blank",
        title: "Batch fetch failed",
        detail: error.message,
        status: 500
      });
    }
  });

  // Cancel job
  app.post("/batch/:id/cancel", async (req, reply) => {
    const id = z.string().parse((req.params as any).id);
    
    try {
      const res = await client.cancel(id);
      app.log.info({ jobId: id, status: res.status }, "Batch job cancel requested");
      return reply.send(res);
    } catch (error: any) {
      app.log.error({ jobId: id, error: error.message }, "Batch cancel failed");
      return reply.code(500).send({
        type: "about:blank",
        title: "Batch cancel failed",
        detail: error.message,
        status: 500
      });
    }
  });

  // Health check
  app.get("/healthz", async () => ({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!apiKey
  }));
  
  app.log.info("Batch routes registered at /batch/*");
}