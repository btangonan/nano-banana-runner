import { request } from "undici";
import { z } from "zod";
import { createOperationLogger } from '../logger.js';

const SubmitRes = z.object({ 
  jobId: z.string(), 
  estCount: z.number() 
}).strict();

const PollRes = z.object({
  status: z.enum(["pending", "running", "succeeded", "failed"]),
  completed: z.number().optional(),
  total: z.number().optional(),
  errors: z.array(z.any()).optional()
}).strict();

const FetchRes = z.object({
  results: z.array(z.object({ 
    id: z.string(), 
    prompt: z.string(), 
    outUrl: z.string().optional() 
  })),
  problems: z.array(z.any())
}).strict();

const CancelRes = z.object({
  status: z.enum(["canceled", "not_found"])
}).strict();

/**
 * Client for the nn-batch-relay proxy service
 * Keeps API keys server-side, provides typed interface
 */
export class BatchRelayClient {
  private log = createOperationLogger('BatchRelayClient');
  
  constructor(private baseUrl = "http://127.0.0.1:8787") {
    this.log.debug({ baseUrl }, 'Initialized batch relay client');
  }

  async submit(body: {
    jobId?: string;
    rows: Array<{ prompt: string; sourceImage?: string; seed?: number; tags?: string[] }>;
    variants: 1 | 2 | 3;
    styleOnly: true;
    styleRefs: string[];
  }) {
    this.log.debug({ rowCount: body.rows.length, variants: body.variants }, 'Submitting batch job');
    
    const r = await request(`${this.baseUrl}/batch/submit`, { 
      method: "POST", 
      headers: { "content-type": "application/json" }, 
      body: JSON.stringify(body) 
    });
    
    if (r.statusCode >= 400) {
      const errorBody = await r.body.text();
      this.log.error({ statusCode: r.statusCode, error: errorBody }, 'Batch submit failed');
      throw new Error(`relay submit ${r.statusCode}: ${errorBody}`);
    }
    
    const result = SubmitRes.parse(await r.body.json());
    this.log.info({ jobId: result.jobId, estCount: result.estCount }, 'Batch job submitted');
    return result;
  }

  async poll(jobId: string) {
    this.log.debug({ jobId }, 'Polling batch job');
    
    const r = await request(`${this.baseUrl}/batch/${encodeURIComponent(jobId)}`);
    
    if (r.statusCode >= 400) {
      const errorBody = await r.body.text();
      this.log.error({ jobId, statusCode: r.statusCode, error: errorBody }, 'Batch poll failed');
      throw new Error(`relay poll ${r.statusCode}: ${errorBody}`);
    }
    
    const result = PollRes.parse(await r.body.json());
    this.log.debug({ jobId, status: result.status, completed: result.completed, total: result.total }, 'Poll result');
    return result;
  }

  async fetch(jobId: string) {
    this.log.debug({ jobId }, 'Fetching batch results');
    
    const r = await request(`${this.baseUrl}/batch/${encodeURIComponent(jobId)}/results`);
    
    if (r.statusCode >= 400) {
      const errorBody = await r.body.text();
      this.log.error({ jobId, statusCode: r.statusCode, error: errorBody }, 'Batch fetch failed');
      throw new Error(`relay fetch ${r.statusCode}: ${errorBody}`);
    }
    
    const result = FetchRes.parse(await r.body.json());
    this.log.info({ 
      jobId, 
      resultCount: result.results.length, 
      problemCount: result.problems.length 
    }, 'Batch results fetched');
    return result;
  }

  async cancel(jobId: string) {
    this.log.debug({ jobId }, 'Canceling batch job');
    
    const r = await request(`${this.baseUrl}/batch/${encodeURIComponent(jobId)}/cancel`, { 
      method: "POST" 
    });
    
    if (r.statusCode >= 400) {
      const errorBody = await r.body.text();
      this.log.error({ jobId, statusCode: r.statusCode, error: errorBody }, 'Batch cancel failed');
      throw new Error(`relay cancel ${r.statusCode}: ${errorBody}`);
    }
    
    const result = CancelRes.parse(await r.body.json());
    this.log.info({ jobId, status: result.status }, 'Batch job cancel result');
    return result;
  }

  async healthCheck(): Promise<{ ok: boolean; timestamp: string; apiKeyConfigured: boolean }> {
    const r = await request(`${this.baseUrl}/healthz`);
    
    if (r.statusCode >= 400) {
      throw new Error(`relay health check failed ${r.statusCode}`);
    }
    
    return await r.body.json() as any;
  }
}