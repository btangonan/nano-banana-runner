import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createOperationLogger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Standard cinematic descriptor schema
 */
const CinematicDescriptorSchema = z.object({
  path: z.string(),
  hash: z.string(),
  provider: z.literal('gemini'),
  width: z.number(),
  height: z.number(),
  format: z.string(),
  
  title: z.string(),
  purpose: z.string(),
  subject: z.string(),
  actions: z.array(z.string()),
  mood: z.array(z.string()),
  
  shot: z.object({
    type: z.string(),
    angle: z.string(),
    lens: z.string(),
    framing: z.string(),
    aspectRatio: z.string()
  }),
  
  environment: z.object({
    location: z.string(),
    surroundings: z.string(),
    surface: z.string(),
    atmosphere: z.array(z.string()),
    elevation: z.string()
  }),
  
  lighting: z.object({
    timeOfDay: z.string(),
    quality: z.string(),
    direction: z.string(),
    color: z.string(),
    contrast: z.string(),
    notes: z.string()
  }),
  
  style: z.array(z.string()),
  filmStockLike: z.string(),
  
  colors: z.object({
    dominant: z.array(z.string()),
    accents: z.array(z.string()),
    palette: z.array(z.string()),
    grading: z.string()
  }),
  
  composition: z.object({
    principles: z.array(z.string()),
    horizon: z.string(),
    lines: z.array(z.string()),
    balance: z.string(),
    depth: z.string()
  }),
  
  textures: z.array(z.string()),
  objects: z.array(z.string()),
  scene: z.string(),
  
  videoHints: z.object({
    camera: z.string(),
    motion: z.array(z.string()),
    looping: z.string(),
    transitions: z.union([z.string(), z.array(z.string())])
  }),
  
  negativeConstraints: z.array(z.string()),
  qualityNotes: z.array(z.string()),
  safetyTags: z.array(z.string()),
  confidence: z.number()
}).strict();

/**
 * Ultra-cinematic descriptor schema with full production fields
 */
const UltraCinematicDescriptorSchema = z.object({
  path: z.string(),
  hash: z.string(),
  provider: z.literal('gemini'),
  width: z.number(),
  height: z.number(),
  format: z.string(),
  
  title: z.string(),
  narrative: z.string().optional(),
  purpose: z.string(),
  subject: z.string(),
  actions: z.array(z.string()),
  mood: z.array(z.string()),
  
  shot: z.object({
    type: z.string(),
    angle: z.string(),
    lens: z.string(),
    framing: z.string(),
    aspectRatio: z.string(),
    focalPoint: z.string().optional(),
    depthOfField: z.string().optional()
  }),
  
  camera: z.object({
    model: z.string(),
    settings: z.string(),
    movement: z.string(),
    motivation: z.string()
  }).optional(),
  
  environment: z.object({
    location: z.string(),
    time: z.string().optional(),
    weather: z.string().optional(),
    surroundings: z.string(),
    surface: z.string().optional(),
    atmosphere: z.array(z.string()).optional(),
    elevation: z.string().optional(),
    soundscape: z.string().optional(),
    temperature: z.string().optional()
  }),
  
  lighting: z.object({
    setup: z.string().optional(),
    quality: z.string(),
    colorTemp: z.string().optional(),
    contrast: z.string(),
    practicals: z.string().optional(),
    shadows: z.string().optional(),
    highlights: z.string().optional(),
    timeOfDay: z.string().optional(),
    direction: z.string().optional(),
    color: z.string().optional(),
    notes: z.string().optional()
  }),
  
  color: z.object({
    palette: z.object({
      primary: z.array(z.string()),
      secondary: z.array(z.string()),
      accent: z.array(z.string())
    }).optional(),
    grading: z.object({
      look: z.string(),
      shadows: z.string().optional(),
      midtones: z.string().optional(),
      highlights: z.string().optional(),
      saturation: z.string().optional()
    }).optional(),
    reference: z.string().optional()
  }).optional(),
  
  // Fallback for standard schema compatibility
  colors: z.object({
    dominant: z.array(z.string()),
    accents: z.array(z.string()),
    palette: z.array(z.string()),
    grading: z.string()
  }).optional(),
  
  filmStock: z.string().optional(),
  filmStockLike: z.string().optional(),
  
  style: z.array(z.string()),
  
  composition: z.object({
    principles: z.array(z.string()),
    leadingLines: z.string().optional(),
    shapes: z.string().optional(),
    balance: z.string(),
    depth: z.string(),
    horizon: z.string().optional(),
    lines: z.array(z.string()).optional()
  }),
  
  textures: z.array(z.string()),
  objects: z.array(z.string()).optional(),
  scene: z.string().optional(),
  
  production: z.object({
    vfx: z.string().optional(),
    stunts: z.string().optional(),
    sfx: z.string().optional(),
    props: z.string().optional()
  }).optional(),
  
  videoHints: z.object({
    duration: z.string().optional(),
    motion: z.array(z.string()),
    looping: z.string().optional(),
    transitions: z.union([z.string(), z.array(z.string())]).optional(),
    fps: z.string().optional(),
    camera: z.string().optional()
  }),
  
  narrative: z.object({
    story: z.string(),
    emotion: z.string(),
    subtext: z.string(),
    symbolism: z.string(),
    foreshadowing: z.string()
  }).optional(),
  
  postProduction: z.object({
    edit: z.string(),
    sound: z.string(),
    music: z.string(),
    colorSpace: z.string()
  }).optional(),
  
  references: z.array(z.string()).optional(),
  director_notes: z.string().optional(),
  
  negativeConstraints: z.array(z.string()),
  qualityNotes: z.array(z.string()).optional(),
  safetyTags: z.array(z.string()).optional(),
  confidence: z.number()
}).strict();

/**
 * Request schema
 */
const DescribeRequestSchema = z.object({
  image: z.string().min(1), // base64 encoded image
  mimeType: z.string().optional(),
}).strict();

/**
 * Preprocess image for Gemini API
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
  const maxEdge = 1536;
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
      quality: 80,
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
 * Call Gemini Vision API with cinematic prompt
 */
async function callGeminiVision(
  imageBuffer: Buffer, 
  apiKey: string,
  promptPath: string,
  timeout: number = 60000 // Longer timeout for detailed descriptions
): Promise<any> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  // Load the cinematic prompt
  const cinematicPrompt = await readFile(promptPath, 'utf-8');
  
  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), timeout);
  });
  
  const apiPromise = model.generateContent([
    { text: cinematicPrompt },
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
 * Parse and validate cinematic JSON response
 */
function parseCinematicResponse(response: any, metadata: any, isUltra: boolean = false): any {
  try {
    // Extract text from Gemini response structure
    const text = response.response?.text?.() || '';
    
    if (!text || typeof text !== 'string') {
      throw new Error('No text content in response');
    }
    
    // Clean up potential markdown or extra formatting
    const cleanText = text.trim().replace(/^```json\s*|```$/gm, '');
    
    // Parse JSON
    const parsed = JSON.parse(cleanText);
    
    // Add metadata that Gemini might not provide
    if (!parsed.width) parsed.width = metadata.width;
    if (!parsed.height) parsed.height = metadata.height;
    if (!parsed.format) parsed.format = metadata.format;
    if (!parsed.provider) parsed.provider = 'gemini';
    
    // Handle filmStock/filmStockLike naming variations
    if (parsed.filmStock && !parsed.filmStockLike) {
      parsed.filmStockLike = parsed.filmStock;
    }
    
    // Validate against appropriate schema
    const schema = isUltra ? UltraCinematicDescriptorSchema : CinematicDescriptorSchema;
    return schema.parse(parsed);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Cinematic analyze route implementation
 */
export default async function cinematicAnalyzeRoutes(app: FastifyInstance) {
  const log = createOperationLogger('CinematicAnalyzeRoute');
  
  app.post('/analyze/cinematic', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Check for ultra mode query parameter
      const isUltra = (request.query as any)?.ultra === 'true';
      
      // Validate request
      const body = DescribeRequestSchema.parse(request.body);
      const { image: base64Image, mimeType = 'image/jpeg' } = body;
      
      // Decode base64 image
      let imageBuffer: Buffer;
      try {
        imageBuffer = Buffer.from(base64Image, 'base64');
      } catch (error) {
        return reply.status(400).send({
          error: 'Invalid base64 image data'
        });
      }
      
      // Preprocess image
      const { processedBuffer, metadata } = await preprocessImage(imageBuffer);
      
      log.info({ 
        originalSize: metadata.sizeBefore, 
        processedSize: metadata.sizeAfter,
        compression: ((metadata.sizeBefore - metadata.sizeAfter) / metadata.sizeBefore * 100).toFixed(1) + '%',
        ultra: isUltra
      }, 'Image preprocessed for cinematic analysis');
      
      // Get API key from environment
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return reply.status(500).send({
          error: 'Gemini API key not configured'
        });
      }
      
      // Choose prompt file based on mode
      const promptFile = isUltra ? 'cinematic-ultra.txt' : 'cinematic-descriptor.txt';
      const promptPath = join(__dirname, '../prompts', promptFile);
      
      // Use longer timeout for ultra mode (120s vs 60s)
      const timeout = isUltra ? 120000 : 60000;
      
      // Call Gemini Vision API with appropriate prompt
      let geminiResponse: any;
      try {
        geminiResponse = await callGeminiVision(processedBuffer, apiKey, promptPath, timeout);
      } catch (error) {
        if (error instanceof Error && error.message === 'Request timeout') {
          return reply.status(504).send({
            error: `Request timeout - ${isUltra ? 'ultra-cinematic' : 'cinematic'} description too complex`
          });
        }
        throw error;
      }
      
      // Parse and validate response with appropriate schema
      let descriptor: any;
      try {
        descriptor = parseCinematicResponse(geminiResponse, metadata, isUltra);
      } catch (error) {
        log.error({ error, ultra: isUltra }, 'Failed to parse cinematic response');
        return reply.status(422).send({
          error: error instanceof Error ? error.message : 'Failed to parse response'
        });
      }
      
      // Add hash
      descriptor.hash = createHash('sha256').update(processedBuffer).digest('hex');
      
      // Record metrics
      const latency = Date.now() - startTime;
      
      log.info({ 
        latency, 
        imageSize: metadata.sizeAfter,
        title: descriptor.title,
        purpose: descriptor.purpose,
        ultra: isUltra
      }, 'Cinematic analysis completed');
      
      return reply.send({ descriptor, ultra: isUltra });
      
    } catch (error) {
      log.error({ error }, 'Cinematic analyze request failed');
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request data',
          details: error.errors
        });
      }
      
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // Test endpoint that analyzes all images in the proxy/images directory
  app.get('/analyze/cinematic/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    
    const imagesDir = path.join(__dirname, '../../images');
    
    try {
      const files = await fs.readdir(imagesDir);
      const imageFiles = files.filter(f => /\.(png|jpg|jpeg)$/i.test(f));
      
      if (imageFiles.length === 0) {
        return reply.send({ message: 'No images found in images directory' });
      }
      
      const results = [];
      
      for (const file of imageFiles.slice(0, 2)) { // Test with first 2 images
        const filePath = path.join(imagesDir, file);
        const imageBuffer = await fs.readFile(filePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Call the cinematic analyze endpoint
        const response = await fetch('http://127.0.0.1:8787/analyze/cinematic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Image })
        });
        
        if (response.ok) {
          const data = await response.json();
          results.push({
            file,
            success: true,
            descriptor: data.descriptor
          });
        } else {
          results.push({
            file,
            success: false,
            error: await response.text()
          });
        }
      }
      
      return reply.send({ 
        tested: imageFiles.length,
        results 
      });
      
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Test failed'
      });
    }
  });
  
  log.info('Cinematic analyze routes registered at /analyze/cinematic');
}