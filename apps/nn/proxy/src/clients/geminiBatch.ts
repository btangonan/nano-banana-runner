import { request } from "undici";

export type SubmitReq = {
  jobId?: string;                 // optional client-provided id
  rows: Array<{ prompt: string; sourceImage?: string; seed?: number; tags?: string[] }>;
  variants: 1 | 2 | 3;
  styleOnly: true;
  styleRefs: string[];            // file paths or URLs; relay may upload/attach
};

export type SubmitRes = { jobId: string; estCount: number };
export type PollRes = { 
  status: "pending" | "running" | "succeeded" | "failed"; 
  completed?: number; 
  total?: number; 
  errors?: any[] 
};
export type FetchRes = { 
  results: Array<{ id: string; prompt: string; outUrl?: string }>; 
  problems: any[] 
};

export class GeminiBatchClient {
  constructor(private apiKey: string) {}

  // NOTE: Using generativelanguage API for batch operations
  async submit(req: SubmitReq): Promise<SubmitRes> {
    // For Gemini Batch, we need to create a batch prediction job
    // This is a simplified implementation - actual API may differ
    const batchRequest = {
      requests: req.rows.map((row, idx) => ({
        model: "models/gemini-2.0-flash-exp",
        contents: [
          {
            role: "system",
            parts: [{ 
              text: "You are an image generator. Generate images based on the prompt with style-only conditioning. Focus on artistic style, not copying content." 
            }]
          },
          {
            role: "user",
            parts: [
              { text: row.prompt },
              ...req.styleRefs.map(ref => ({ 
                inlineData: { 
                  mimeType: "image/png", 
                  data: ref  // In real implementation, this would be base64 encoded image data
                }
              }))
            ]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 4096,
          candidateCount: req.variants
        }
      }))
    };

    const r = await request("https://generativelanguage.googleapis.com/v1beta/batchPredictions", {
      method: "POST",
      headers: { 
        "content-type": "application/json", 
        "x-goog-api-key": this.apiKey 
      },
      body: JSON.stringify(batchRequest)
    });
    
    if (r.statusCode >= 400) {
      const body = await r.body.text();
      throw new Error(`submit failed ${r.statusCode}: ${body}`);
    }
    
    const body = await r.body.json() as any;
    return { 
      jobId: body.name ?? body.jobId ?? "job-" + Date.now(), 
      estCount: req.rows.length * req.variants 
    };
  }

  async poll(jobId: string): Promise<PollRes> {
    const r = await request(`https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: { "x-goog-api-key": this.apiKey }
    });
    
    if (r.statusCode >= 400) {
      const body = await r.body.text();
      throw new Error(`poll failed ${r.statusCode}: ${body}`);
    }
    
    const body = await r.body.json() as any;
    
    // Map provider states to our standard states
    let status: PollRes["status"] = "pending";
    if (body.state === "PROCESSING" || body.state === "RUNNING") status = "running";
    else if (body.state === "SUCCEEDED" || body.state === "DONE") status = "succeeded";
    else if (body.state === "FAILED" || body.state === "CANCELLED") status = "failed";
    
    return { 
      status, 
      completed: body.completedCount ?? 0, 
      total: body.totalCount ?? 0, 
      errors: body.errors ?? [] 
    };
  }

  async fetch(jobId: string): Promise<FetchRes> {
    const r = await request(`https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(jobId)}:get`, {
      method: "GET",
      headers: { "x-goog-api-key": this.apiKey }
    });
    
    if (r.statusCode >= 400) {
      const body = await r.body.text();
      throw new Error(`fetch failed ${r.statusCode}: ${body}`);
    }
    
    const body = await r.body.json() as any;
    
    // Extract results from batch response
    const results = (body.responses ?? []).map((resp: any, idx: number) => ({
      id: `result-${idx}`,
      prompt: resp.request?.contents?.[1]?.parts?.[0]?.text ?? "",
      outUrl: resp.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data 
        ? `data:image/png;base64,${resp.response.candidates[0].content.parts[0].inlineData.data}`
        : undefined
    }));
    
    const problems = (body.errors ?? []).map((err: any) => ({
      type: "about:blank",
      title: "Batch generation error",
      detail: err.message ?? "Unknown error",
      status: 500
    }));
    
    return { results, problems };
  }

  async cancel(jobId: string): Promise<{ status: "canceled" | "not_found" }> {
    const r = await request(`https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(jobId)}:cancel`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey }
    });
    
    if (r.statusCode === 404) return { status: "not_found" };
    if (r.statusCode >= 400) {
      const body = await r.body.text();
      throw new Error(`cancel failed ${r.statusCode}: ${body}`);
    }
    
    return { status: "canceled" };
  }
}