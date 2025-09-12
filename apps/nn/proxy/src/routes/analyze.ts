import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'node:crypto';
import { createOperationLogger } from '../utils/logger.js';
import { ImageDescriptorSchema, ANALYZE_ERROR_TYPES } from '../../../src/core/providers/types.js';

/**
 * Canonical system prompt for strict JSON-only image description
 * Commands the model to return only JSON without any prose
 */
const DESCRIBE_IMAGE_SYSTEM_PROMPT = `You are an expert image analyst. Analyze the provided image and return ONLY a JSON object with no additional text, explanations, or prose.

IMPORTANT: Your response must be valid JSON only. Do not include markdown code blocks, explanations, or any text outside the JSON.

Return exactly this JSON structure:
{
  "objects": ["list", "of", "detected", "objects"],
  "scene": "brief scene description (max 256 chars)",
  "style": ["artistic", "style", "attributes"],
  "composition": "compositional analysis (max 256 chars)",
  "colors": ["#hex", "or", "named", "colors"],
  "lighting": "lighting description (max 256 chars)",
  "qualityIssues": ["any", "quality", "problems"],
  "safetyTags": ["content", "warnings", "if", "any"],
  "confidence": 0.95
}

Constraints:
- objects: max 20 items
- style: max 10 items  
- colors: max 10 items (use hex codes like #FF0000 or color names)
- confidence: number between 0 and 1
- All text fields must be under their character limits
- Return empty arrays [] for missing elements
- Return ONLY the JSON object, no other text`;

/**
 * Stricter retry prompt for when initial response contains invalid JSON
 */
const STRICT_JSON_RETRY_PROMPT = `CRITICAL: Return ONLY valid JSON. No markdown, no explanations, no text outside JSON.

Your previous response was not valid JSON. Return exactly this structure with no additional content:

{"objects":[],"scene":"","style":[],"composition":"","colors":[],"lighting":"","qualityIssues":[],"safetyTags":[],"confidence":0.0}

Replace empty values with your analysis but maintain exact JSON format.`;

/**
 * Image preprocessing configuration
 */
const PREPROCESS_CONFIG = {
  maxEdgePixels: 1536,
  quality: 0.8,
  format: 'jpeg' as const,
  stripMetadata: true,
};

/**
 * Request validation schema
 */
const DescribeRequestSchema = z.object({
  image: z.string().min(1), // base64 encoded image
  mimeType: z.string().optional(),
  dryRun: z.boolean().default(false),
}).strict();

/**
 * Response schema
 */
const DescribeResponseSchema = z.object({
  descriptor: ImageDescriptorSchema.optional(),
  costEstimate: z.object({
    imageCount: z.number(),
    estimatedCost: z.number(),
    estimatedTimeMs: z.number(),
    provider: z.literal('gemini'),
  }).optional(),
  error: z.object({
    type: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    status: z.number(),
    retryable: z.boolean(),
    costIncurred: z.number(),
  }).optional(),
}).strict();

/**
 * Simple metrics collection
 */
class AnalyzeMetrics {
  private metrics = {
    requests_total: 0,
    failures_total: 0,
    rate_limited_total: 0,
    latency_histogram: [] as number[],
  };

  incrementRequests() {
    this.metrics.requests_total++;
  }

  incrementFailures(errorType: string) {
    this.metrics.failures_total++;
    if (errorType === ANALYZE_ERROR_TYPES.RATE_LIMITED) {
      this.metrics.rate_limited_total++;
    }
  }

  recordLatency(latencyMs: number) {
    this.metrics.latency_histogram.push(latencyMs);
    // Keep histogram size manageable
    if (this.metrics.latency_histogram.length > 1000) {
      this.metrics.latency_histogram = this.metrics.latency_histogram.slice(-500);
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

const analyzeMetrics = new AnalyzeMetrics();

/**
 * Preprocess image for Gemini API
 * Resizes to optimal dimensions and compresses for cost/latency optimization
 */
async function preprocessImage(imageBuffer: Buffer): Promise<{
  processedBuffer: Buffer;
  metadata: { width: number; height: number; format: string; sizeBefore: number; sizeAfter: number; };
}> {
  const originalSize = imageBuffer.length;
  
  // Get original metadata
  const originalMetadata = await sharp(imageBuffer).metadata();
  const { width = 0, height = 0 } = originalMetadata;
  
  // Calculate new dimensions maintaining aspect ratio
  const maxEdge = PREPROCESS_CONFIG.maxEdgePixels;
  let newWidth = width;
  let newHeight = height;
  
  if (width > maxEdge || height > maxEdge) {
    const ratio = Math.min(maxEdge / width, maxEdge / height);
    newWidth = Math.round(width * ratio);
    newHeight = Math.round(height * ratio);
  }
  
  // Process image
  const processedBuffer = await sharp(imageBuffer)
    .resize(newWidth, newHeight, { fit: 'inside' })
    .jpeg({ 
      quality: Math.round(PREPROCESS_CONFIG.quality * 100),
      progressive: true 
    })
    .toBuffer();
  
  return {
    processedBuffer,
    metadata: {
      width: newWidth,
      height: newHeight,
      format: 'jpeg',
      sizeBefore: originalSize,
      sizeAfter: processedBuffer.length,
    }
  };
}

/**
 * Call Gemini Vision API for image description
 */
async function callGeminiVision(
  imageBuffer: Buffer, 
  apiKey: string,
  timeout: number = 30000,
  isRetry: boolean = false
): Promise<any> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-vision-latest" });
  
  const systemPrompt = isRetry ? STRICT_JSON_RETRY_PROMPT : DESCRIBE_IMAGE_SYSTEM_PROMPT;
  
  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), timeout);
  });
  
  const apiPromise = model.generateContent([
    { text: systemPrompt },
    {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: "image/jpeg"
      }
    }
  ]);
  
  return Promise.race([apiPromise, timeoutPromise]);
}

/**
 * Parse and validate JSON response from Gemini
 */
function parseGeminiResponse(response: any): any {
  try {
    // Extract text from Gemini response structure
    const text = response.response?.text?.() || '';
    
    if (!text || typeof text !== 'string') {
      throw new Error('No text content in response');
    }
    
    // Clean up potential markdown or extra formatting
    const cleanText = text.trim().replace(/^```json\s*|\s*```$/g, '');
    
    // Parse JSON
    const parsed = JSON.parse(cleanText);
    
    // Validate against schema
    return ImageDescriptorSchema.omit({ provider: true, path: true, hash: true }).parse(parsed);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create RFC 7807 Problem+JSON error response
 */
function createProblemResponse(
  errorType: string,
  title: string,
  status: number,
  detail?: string,
  retryable: boolean = false,
  costIncurred: number = 0
) {
  return {
    type: errorType,
    title,
    detail,
    status,
    retryable,
    costIncurred,
    provider: 'gemini',
  };
}

/**
 * Estimate cost for Gemini Vision API
 * Based on current Gemini 1.5 Pro Vision pricing
 */
function estimateCost(imageCount: number, avgImageSize: number = 1000000): number {
  // Gemini 1.5 Pro Vision pricing: ~$0.0025 per image under 4MB
  const basePrice = 0.0025;
  
  // Size-based adjustment (larger images cost more)
  const sizeFactor = Math.min(2.0, avgImageSize / 1000000); // Cap at 2x for very large images
  
  return imageCount * basePrice * sizeFactor;
}

/**
 * Analyze route implementation
 */
export default async function analyzeRoutes(app: FastifyInstance) {
  const log = createOperationLogger('AnalyzeRoute');
  
  app.post('/analyze/describe', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    analyzeMetrics.incrementRequests();
    
    try {
      // Validate request
      const body = DescribeRequestSchema.parse(request.body);
      const { image: base64Image, mimeType = 'image/jpeg', dryRun } = body;
      
      // Decode base64 image
      let imageBuffer: Buffer;
      try {
        imageBuffer = Buffer.from(base64Image, 'base64');
      } catch (error) {
        return reply.status(400).send(createProblemResponse(
          'invalid_image',
          'Invalid base64 image data',
          400,
          'Could not decode base64 image data',
          false,
          0
        ));
      }
      
      // Preprocess image
      const { processedBuffer, metadata } = await preprocessImage(imageBuffer);
      
      log.info({ 
        originalSize: metadata.sizeBefore, 
        processedSize: metadata.sizeAfter,
        compression: ((metadata.sizeBefore - metadata.sizeAfter) / metadata.sizeBefore * 100).toFixed(1) + '%'
      }, 'Image preprocessed');
      
      // Handle dry-run mode
      if (dryRun) {
        const cost = estimateCost(1, metadata.sizeAfter);
        const estimatedTimeMs = 2000; // Estimate ~2s per image
        
        return reply.send({
          costEstimate: {
            imageCount: 1,
            estimatedCost: cost,
            estimatedTimeMs,
            provider: 'gemini',
          }
        });
      }
      
      // Get API key from environment
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return reply.status(500).send(createProblemResponse(
          'configuration_error',
          'Gemini API key not configured',
          500,
          'Missing GEMINI_API_KEY environment variable',
          false,
          0
        ));
      }
      
      // Call Gemini Vision API with retries
      let geminiResponse: any;
      let attempts = 0;
      const maxAttempts = 3;
      const backoffMs = [200, 400, 800];
      
      while (attempts < maxAttempts) {
        try {
          const isRetry = attempts > 0;
          geminiResponse = await callGeminiVision(processedBuffer, apiKey, 30000, isRetry);
          break;
        } catch (error) {
          attempts++;
          
          if (error instanceof Error && error.message === 'Request timeout') {
            if (attempts >= maxAttempts) {
              analyzeMetrics.incrementFailures(ANALYZE_ERROR_TYPES.TIMEOUT);
              return reply.status(504).send(createProblemResponse(
                ANALYZE_ERROR_TYPES.TIMEOUT,
                'Request timeout',
                504,
                'Gemini API request exceeded 30 second timeout',
                true,
                estimateCost(1, metadata.sizeAfter)
              ));
            }
          } else if (error instanceof Error && error.message.includes('429')) {
            analyzeMetrics.incrementFailures(ANALYZE_ERROR_TYPES.RATE_LIMITED);
            return reply.status(429).send(createProblemResponse(
              ANALYZE_ERROR_TYPES.RATE_LIMITED,
              'Rate limit exceeded',
              429,
              'Gemini API rate limit exceeded',
              true,
              0
            ));
          } else if (attempts >= maxAttempts) {
            analyzeMetrics.incrementFailures(ANALYZE_ERROR_TYPES.UPSTREAM_ERROR);
            return reply.status(502).send(createProblemResponse(
              ANALYZE_ERROR_TYPES.UPSTREAM_ERROR,
              'Upstream API error',
              502,
              `Gemini API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              false,
              estimateCost(1, metadata.sizeAfter)
            ));
          }
          
          // Wait before retry
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, backoffMs[attempts - 1]));
          }
        }
      }
      
      // Parse and validate response
      let parsedResponse: any;
      try {
        parsedResponse = parseGeminiResponse(geminiResponse);
      } catch (error) {
        analyzeMetrics.incrementFailures(ANALYZE_ERROR_TYPES.INVALID_JSON);
        return reply.status(422).send(createProblemResponse(
          ANALYZE_ERROR_TYPES.INVALID_JSON,
          'Invalid JSON response from model',
          422,
          error instanceof Error ? error.message : 'Model returned non-JSON content',
          true,
          estimateCost(1, metadata.sizeAfter)
        ));
      }
      
      // Create full ImageDescriptor
      const descriptor = {
        provider: 'gemini' as const,
        path: '', // Will be set by client
        hash: createHash('sha256').update(processedBuffer).digest('hex'),
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        ...parsedResponse,
      };
      
      // Record metrics
      const latency = Date.now() - startTime;
      analyzeMetrics.recordLatency(latency);
      
      log.info({ 
        latency, 
        imageSize: metadata.sizeAfter,
        confidence: parsedResponse.confidence 
      }, 'Image analyzed successfully');
      
      return reply.send({ descriptor });
      
    } catch (error) {
      analyzeMetrics.incrementFailures('validation_error');
      log.error({ error }, 'Analyze request failed');
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send(createProblemResponse(
          'validation_error',
          'Invalid request data',
          400,
          error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
          false,
          0
        ));
      }
      
      return reply.status(500).send(createProblemResponse(
        'internal_error',
        'Internal server error',
        500,
        error instanceof Error ? error.message : 'Unknown error',
        false,
        0
      ));
    }
  });
  
  // Metrics endpoint
  app.get('/analyze/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(analyzeMetrics.getMetrics());
  });
}