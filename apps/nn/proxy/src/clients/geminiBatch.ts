import { request } from "undici";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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

// In-memory storage for job status and results
const jobs = new Map<string, {
  status: PollRes["status"];
  completed: number;
  total: number;
  results: Array<{ id: string; prompt: string; outUrl?: string }>;
  problems: any[];
  errors?: any[];
}>();

export class GeminiBatchClient {
  constructor(private apiKey: string) {}

  // Submit individual image generation requests (no real batch API exists)
  async submit(req: SubmitReq): Promise<SubmitRes> {
    const jobId = req.jobId ?? "job-" + Date.now();
    const totalImages = req.rows.length * req.variants;
    
    // Initialize job tracking
    jobs.set(jobId, {
      status: "pending",
      completed: 0,
      total: totalImages,
      results: [],
      problems: [],
      errors: []
    });

    // Process images asynchronously (don't await)
    this.processImagesAsync(jobId, req).catch(error => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "failed";
        job.errors = [{ message: error.message }];
      }
    });

    return { 
      jobId, 
      estCount: totalImages 
    };
  }

  async poll(jobId: string): Promise<PollRes> {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`poll failed 404: Job not found: ${jobId}`);
    }
    
    return { 
      status: job.status, 
      completed: job.completed, 
      total: job.total, 
      errors: job.errors ?? [] 
    };
  }

  async fetch(jobId: string): Promise<FetchRes> {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`fetch failed 404: Job not found: ${jobId}`);
    }
    
    return { 
      results: job.results, 
      problems: job.problems 
    };
  }

  async cancel(jobId: string): Promise<{ status: "canceled" | "not_found" }> {
    const job = jobs.get(jobId);
    if (!job) {
      return { status: "not_found" };
    }
    
    job.status = "failed"; // Mark as failed to stop processing
    return { status: "canceled" };
  }

  // Process images individually using the real Gemini API
  private async processImagesAsync(jobId: string, req: SubmitReq): Promise<void> {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = "running";

    try {
      // Load and encode reference images to base64
      const styleRefsBase64: Array<{ mimeType: string; data: string }> = [];
      for (const refPath of req.styleRefs) {
        try {
          const imageBuffer = await readFile(refPath);
          const base64Data = imageBuffer.toString('base64');
          const mimeType = this.getMimeType(refPath);
          styleRefsBase64.push({ mimeType, data: base64Data });
        } catch (error) {
          console.warn(`Failed to load reference image: ${refPath}`, error);
        }
      }

      // Process each prompt with variants
      for (let i = 0; i < req.rows.length; i++) {
        const row = req.rows[i];
        
        for (let v = 0; v < req.variants; v++) {
          if (job.status === "failed") break; // Check for cancellation
          
          try {
            const result = await this.generateSingleImage(row, styleRefsBase64);
            const resultId = `${i}-${v}`;
            
            job.results.push({
              id: resultId,
              prompt: row.prompt,
              outUrl: result.outUrl
            });
            job.completed++;
            
          } catch (error) {
            job.problems.push({
              type: "about:blank",
              title: "Image generation failed",
              detail: error instanceof Error ? error.message : "Unknown error",
              status: 500
            });
            job.completed++; // Still count as processed
          }
        }
      }
      
      if (job.status === "running") {
        job.status = "succeeded";
      }
      
    } catch (error) {
      job.status = "failed";
      job.errors = [{ message: error instanceof Error ? error.message : "Unknown error" }];
    }
  }

  // Generate a single image using Gemini 2.5 Flash image generation model
  private async generateSingleImage(
    row: { prompt: string; sourceImage?: string; seed?: number; tags?: string[] },
    styleRefs: Array<{ mimeType: string; data: string }>
  ): Promise<{ outUrl?: string }> {
    // Create full prompt with style conditioning
    let fullPrompt = `Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, or layout.\n\n${row.prompt}`;
    
    // Build parts array for Gemini API
    const parts: any[] = [
      { text: fullPrompt }
    ];
    
    // Add reference images as inline data if available
    if (styleRefs.length > 0) {
      for (const ref of styleRefs) {
        parts.push({
          inline_data: {
            mime_type: ref.mimeType,
            data: ref.data
          }
        });
      }
      parts.push({ text: "\n\nApply the artistic style and mood from the reference images above to the generated image." });
    }

    const requestBody = {
      contents: [{
        parts: parts
      }]
    };

    const r = await request("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(requestBody)
    });
    
    if (r.statusCode >= 400) {
      const body = await r.body.text();
      throw new Error(`generate failed ${r.statusCode}: ${body}`);
    }
    
    const body = await r.body.json() as any;
    
    // Extract base64 image data from Gemini response
    const candidate = body.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
    
    if (imagePart?.inlineData?.data) {
      return {
        outUrl: `data:image/png;base64,${imagePart.inlineData.data}`
      };
    }
    
    throw new Error("No image data in response");
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/png';
    }
  }
}