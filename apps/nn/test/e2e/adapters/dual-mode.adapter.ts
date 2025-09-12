/**
 * Dual-Mode E2E Test Adapter with Record/Replay Pattern
 * Supports: mock | live | record | replay modes
 * Features: Budget tracking, deterministic cassettes, strict schema validation
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type Mode = 'mock' | 'live' | 'record' | 'replay';

/**
 * Strict schema for Gemini API responses
 * All modes must conform to this schema
 */
const GeminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ 
      parts: z.array(z.any()),
      role: z.string().optional()
    }),
    finishReason: z.string().optional(),
    index: z.number().optional(),
    safetyRatings: z.array(z.any()).optional()
  })),
  promptFeedback: z.object({
    safetyRatings: z.array(z.any()).optional()
  }).optional()
}).strict();

/**
 * Schema for image descriptor responses (Gemini Vision)
 */
const ImageDescriptorSchema = z.object({
  objects: z.array(z.string()).max(20),
  scene: z.string().max(256),
  style: z.array(z.string()).max(10),
  composition: z.string().max(256),
  colors: z.array(z.string()).max(10),
  lighting: z.string().max(256),
  qualityIssues: z.array(z.string()),
  safetyTags: z.array(z.string()),
  confidence: z.number().min(0).max(1)
}).strict();

/**
 * Cost report schema for CI budget tracking
 */
const CostReportSchema = z.object({
  spentUSD: z.number(),
  requestCount: z.number(),
  mode: z.enum(['mock', 'live', 'record', 'replay']),
  timestamp: z.string()
});

// Environment configuration
const VERSION_TAG = process.env.E2E_VERSION_TAG ?? 'gemini-2.5-flash-image-preview@2025-09';
const BUDGET_USD = Number(process.env.E2E_BUDGET_USD ?? '0.50');

// Get cassette directory dynamically to support test configuration
const getCassetteDir = () => process.env.E2E_CASSETTES_DIR ?? 'test/e2e/fixtures/recordings';
const COST_REPORT_PATH = process.env.E2E_COST_REPORT_PATH ?? 'test/e2e/.artifacts/cost.json';

/**
 * Generate deterministic cassette key from request
 * SHA256(VERSION_TAG + normalized_request)
 */
function keyOf(request: unknown): string {
  // Normalize request for stable keys
  const normalized = JSON.stringify(request, (_key, value) => {
    // Redact long strings to prevent huge keys
    if (typeof value === 'string' && value.length > 200) {
      return value.slice(0, 200) + '...[truncated]';
    }
    // Remove headers/auth from key
    if (_key === 'headers' || _key === 'authorization') {
      return '[redacted]';
    }
    return value;
  });
  
  return createHash('sha256')
    .update(VERSION_TAG + normalized)
    .digest('hex');
}

/**
 * Calculate estimated cost for a request
 */
function estimateCost(request: any): number {
  // Image generation: $0.0025 per image
  if (request.type === 'generate') {
    return 0.0025 * (request.variants || 1);
  }
  
  // Vision API: $0.00025 per 1k chars
  if (request.type === 'vision') {
    const chars = JSON.stringify(request).length;
    return (chars / 1000) * 0.00025;
  }
  
  // Default cost estimate
  return 0.0025;
}

/**
 * Main test adapter with 4 modes
 */
export class GeminiTestAdapter {
  private spent = 0;
  private requestCount = 0;
  private mode: Mode;
  private realAPI: { call: (req: any) => Promise<any> } | null;
  
  constructor(
    mode: Mode = (process.env.E2E_MODE as Mode) || 'mock',
    realAPI?: { call: (req: any) => Promise<any> }
  ) {
    this.mode = mode;
    this.realAPI = realAPI || null;
  }
  
  /**
   * Check if we can spend the estimated cost
   */
  canSpend(usd: number): boolean {
    return (this.spent + usd) <= BUDGET_USD;
  }
  
  /**
   * Track spent amount
   */
  track(usd: number): void {
    this.spent += usd;
    this.requestCount += 1;
  }
  
  /**
   * Get current cost report
   */
  getCostReport(): z.infer<typeof CostReportSchema> {
    return {
      spentUSD: this.spent,
      requestCount: this.requestCount,
      mode: this.mode,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Save cost report to file
   */
  async saveCostReport(): Promise<void> {
    const report = this.getCostReport();
    const reportPath = process.env.E2E_COST_REPORT_PATH || 'test/e2e/.artifacts/cost.json';
    const dir = reportPath.substring(0, reportPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
  
  /**
   * Main API call method - handles all 4 modes
   */
  async callAPI(request: any): Promise<any> {
    const key = keyOf(request);
    const CASSETTE_DIR = getCassetteDir();
    const cassetteFile = join(CASSETTE_DIR, `${key}.json`);
    const estCost = estimateCost(request);
    
    // REPLAY MODE: Load from cassette
    if (this.mode === 'replay') {
      if (!existsSync(cassetteFile)) {
        throw new Error(
          `Cassette not found: ${key}.json\n` +
          `Run tests with E2E_MODE=record to create cassettes`
        );
      }
      
      const buffer = await readFile(cassetteFile);
      const data = JSON.parse(buffer.toString());
      
      // Validate cassette against schema
      const parsed = GeminiResponseSchema.safeParse(data);
      if (!parsed.success) {
        // Treat invalid cassettes as missing (corrupted)
        throw new Error(`Cassette not found: ${key}`);
      }
      return parsed.data;
    }
    
    // MOCK MODE: Use existing mocks
    if (this.mode === 'mock') {
      if (!this.realAPI) {
        throw new Error('Mock mode requires realAPI with mock implementation');
      }
      
      // Call mock implementation
      const response = await this.realAPI.call({ ...request, _mock: true });
      
      // Validate mock response against schema
      return GeminiResponseSchema.parse(response);
    }
    
    // Budget check for live/record modes
    if (this.mode === 'live' || this.mode === 'record') {
      if (!this.canSpend(estCost)) {
        throw new Error(
          `Budget exceeded: $${this.spent.toFixed(3)} + $${estCost.toFixed(3)} > $${BUDGET_USD}\n` +
          `Reduce test scope or increase E2E_BUDGET_USD`
        );
      }
      
      if (!this.realAPI) {
        throw new Error(`${this.mode} mode requires real API implementation`);
      }
    }
    
    // LIVE MODE: Call real API
    if (this.mode === 'live') {
      const response = await this.realAPI!.call(request);
      const validated = GeminiResponseSchema.parse(response);
      this.track(estCost);
      return validated;
    }
    
    // RECORD MODE: Call real API and save cassette
    if (this.mode === 'record') {
      const response = await this.realAPI!.call(request);
      
      // Redact sensitive data BEFORE validation
      const redacted = JSON.parse(JSON.stringify(response));
      delete redacted.apiKey;
      delete redacted.authorization;
      delete redacted.token;
      
      const validated = GeminiResponseSchema.parse(redacted);
      this.track(estCost);
      
      // Save cassette for future replay
      const dir = getCassetteDir();
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.json`), JSON.stringify(validated, null, 2));
      
      return validated;
    }
    
    throw new Error(`Unknown mode: ${this.mode}`);
  }
  
  /**
   * Call Vision API for image analysis
   */
  async analyzeImage(imageBuffer: Buffer, mimeType = 'image/jpeg'): Promise<any> {
    const request = {
      type: 'vision',
      image: imageBuffer.toString('base64').slice(0, 200), // Truncate for key
      mimeType,
      model: 'gemini-2.5-flash'
    };
    
    const response = await this.callAPI(request);
    
    // Extract and validate descriptor from response
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      const text = response.candidates[0].content.parts[0].text;
      const descriptor = JSON.parse(text);
      return ImageDescriptorSchema.parse(descriptor);
    }
    
    throw new Error('Invalid Vision API response structure');
  }
  
  /**
   * Call generation API for image creation
   */
  async generateImage(prompt: string, styleRefs: Buffer[] = []): Promise<any> {
    const request = {
      type: 'generate',
      prompt,
      styleRefs: styleRefs.map(ref => ref.toString('base64').slice(0, 100)),
      model: 'gemini-2.5-flash-image-preview',
      variants: 1
    };
    
    return this.callAPI(request);
  }
  
  /**
   * Reset adapter state
   */
  reset(): void {
    this.spent = 0;
    this.requestCount = 0;
  }
  
  /**
   * Get adapter statistics
   */
  getStats() {
    return {
      mode: this.mode,
      spent: this.spent,
      requestCount: this.requestCount,
      budgetRemaining: BUDGET_USD - this.spent,
      budgetPercentUsed: (this.spent / BUDGET_USD) * 100
    };
  }
}

// Export schemas for use in tests
export { 
  GeminiResponseSchema, 
  ImageDescriptorSchema,
  CostReportSchema 
};