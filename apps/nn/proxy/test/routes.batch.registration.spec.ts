import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fastify, { FastifyInstance } from "fastify";
import batchRoutes from "../src/routes/batch";

describe("/batch/* routes are registered", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = fastify({ logger: false });
    
    // Register batch routes
    await app.register(batchRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers /batch/submit endpoint", async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/batch/submit");
  });

  it("registers /batch/:id endpoint for polling", async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/batch/:id");
  });

  it("registers /batch/:id/results endpoint", async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/batch/:id/results");
  });

  it("registers /batch/:id/cancel endpoint", async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/batch/:id/cancel");
  });

  it("does not return 404 for batch endpoints", async () => {
    // Submit endpoint should exist (will error without body, but not 404)
    const submitResponse = await app.inject({
      method: "POST",
      url: "/batch/submit",
      payload: {}
    });
    expect(submitResponse.statusCode).not.toBe(404);

    // Poll endpoint should exist
    const pollResponse = await app.inject({
      method: "GET",
      url: "/batch/test-job-id"
    });
    expect(pollResponse.statusCode).not.toBe(404);

    // Results endpoint should exist
    const resultsResponse = await app.inject({
      method: "GET",
      url: "/batch/test-job-id/results"
    });
    expect(resultsResponse.statusCode).not.toBe(404);

    // Cancel endpoint should exist
    const cancelResponse = await app.inject({
      method: "POST",
      url: "/batch/test-job-id/cancel"
    });
    expect(cancelResponse.statusCode).not.toBe(404);
  });

  it("batch routes do not use fastify-plugin wrapper", () => {
    // This test ensures the batch routes module doesn't use fastify-plugin
    // which was causing registration issues
    const batchRoutesCode = batchRoutes.toString();
    expect(batchRoutesCode).not.toContain("fastify-plugin");
    expect(batchRoutesCode).not.toContain("fp(");
  });

  it("logs batch route registration", async () => {
    const logMessages: string[] = [];
    const testApp = fastify({ 
      logger: {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname'
          }
        }
      }
    });

    // Capture log messages
    testApp.log = {
      ...testApp.log,
      info: (msg: any) => {
        if (typeof msg === 'string') {
          logMessages.push(msg);
        } else if (msg.msg) {
          logMessages.push(msg.msg);
        }
      }
    } as any;

    await testApp.register(batchRoutes);
    await testApp.ready();

    // Should have logged registration
    expect(logMessages).toContain("Batch routes registered at /batch/*");

    await testApp.close();
  });
});