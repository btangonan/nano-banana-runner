/**
 * Vertex AI response parser for image generation
 * Extracts image data from generateContent() responses
 */

export type VertexImagePart = {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  text?: string;
};

export type VertexCandidate = {
  content?: {
    role?: string;
    parts?: VertexImagePart[];
  };
  finishReason?: string;
  safetyRatings?: Array<{
    category?: string;
    probability?: string;
  }>;
};

export type VertexResponse = {
  candidates?: VertexCandidate[];
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: Array<{
      category?: string;
      probability?: string;
    }>;
  };
};

/**
 * Extract the first base64 image data from a Vertex response
 * Returns null if no image found or response is malformed
 */
export function extractFirstImageBase64(resp: any): string | null {
  try {
    // Validate response structure
    if (!resp || typeof resp !== 'object') {
      return null;
    }
    
    const candidates: VertexCandidate[] = resp?.candidates ?? [];
    
    // Iterate through candidates to find first image
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? [];
      
      for (const part of parts) {
        // Check for inline image data
        const base64Data = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;
        
        // Validate it's an image and has sufficient data
        if (
          base64Data && 
          typeof base64Data === 'string' && 
          base64Data.length > 64 &&
          mimeType && 
          (mimeType.startsWith('image/') || mimeType === 'application/octet-stream')
        ) {
          return base64Data;
        }
      }
    }
    
    return null;
  } catch (error) {
    // Fail safely on any parsing error
    return null;
  }
}

/**
 * Convert base64 string to PNG buffer
 * Throws if base64 is invalid
 */
export function toPngBufferFromB64(b64: string): Buffer {
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Invalid base64 input');
  }
  
  // Remove any data URL prefix if present
  const cleanB64 = b64.replace(/^data:image\/[a-z]+;base64,/, '');
  
  return Buffer.from(cleanB64, 'base64');
}

/**
 * Extract text content from response (for debugging)
 */
export function extractTextContent(resp: any): string | null {
  try {
    const candidates: VertexCandidate[] = resp?.candidates ?? [];
    
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? [];
      
      for (const part of parts) {
        if (part?.text && typeof part.text === 'string') {
          return part.text;
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if response was blocked for safety reasons
 */
export function isBlockedResponse(resp: any): boolean {
  try {
    // Check prompt feedback for blocks
    if (resp?.promptFeedback?.blockReason) {
      return true;
    }
    
    // Check if all candidates were filtered
    const candidates = resp?.candidates ?? [];
    if (candidates.length === 0 && resp?.promptFeedback) {
      return true;
    }
    
    // Check individual candidate finish reasons
    for (const candidate of candidates) {
      if (candidate?.finishReason === 'SAFETY' || 
          candidate?.finishReason === 'BLOCKED') {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Get block reason if response was blocked
 */
export function getBlockReason(resp: any): string | null {
  try {
    // Check prompt feedback
    if (resp?.promptFeedback?.blockReason) {
      return `Blocked by prompt filter: ${resp.promptFeedback.blockReason}`;
    }
    
    // Check candidate finish reasons
    const candidates = resp?.candidates ?? [];
    for (const candidate of candidates) {
      if (candidate?.finishReason === 'SAFETY') {
        return 'Blocked by safety filter';
      }
      if (candidate?.finishReason === 'BLOCKED') {
        return 'Response blocked';
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse and validate a complete Vertex response for image generation
 */
export function parseImageGenerationResponse(resp: any): {
  success: boolean;
  imageData?: string;
  textContent?: string;
  error?: string;
} {
  // Check if blocked
  if (isBlockedResponse(resp)) {
    return {
      success: false,
      error: getBlockReason(resp) || 'Response blocked by safety filters'
    };
  }
  
  // Try to extract image data
  const imageData = extractFirstImageBase64(resp);
  if (imageData) {
    return {
      success: true,
      imageData
    };
  }
  
  // Try to extract text (might be an error message)
  const textContent = extractTextContent(resp);
  if (textContent) {
    return {
      success: false,
      textContent,
      error: 'Response contained text instead of image'
    };
  }
  
  // No useful content found
  return {
    success: false,
    error: 'No image or text content found in response'
  };
}