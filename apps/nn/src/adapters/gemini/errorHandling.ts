import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { createOperationLogger } from '../../logger.js';

/**
 * Save HTML error response for debugging
 * Extracted from geminiImage.ts for better error management
 * @param content - HTML content to save
 * @param errorType - Type of error for filename
 * @returns Path to saved artifact or empty string on failure
 */
export async function saveHtmlErrorArtifact(
  content: string,
  errorType: string
): Promise<string> {
  const log = createOperationLogger('saveHtmlErrorArtifact');
  const errorDir = join(env.NN_OUT_DIR, 'artifacts', 'errors');
  
  try {
    await mkdir(errorDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vertex_${errorType}_${timestamp}.html`;
    const filepath = join(errorDir, filename);
    
    // Save first 512 bytes for analysis
    const truncated = content.slice(0, 512);
    await writeFile(filepath, truncated, 'utf-8');
    
    log.info({ filepath, size: truncated.length }, 'Saved HTML error artifact');
    return filepath;
  } catch (err) {
    log.error({ error: err }, 'Failed to save HTML error artifact');
    return '';
  }
}

/**
 * Create a Problem+JSON error object
 * Following RFC 7807 standard for API error responses
 */
export interface ProblemDetails {
  type: string;
  title: string;
  detail: string;
  status: number;
  instance: string;
  meta?: Record<string, any>;
}

/**
 * Create a standardized Vertex AI error
 * @param type - Error type URN
 * @param title - Short error title
 * @param detail - Detailed error description
 * @param status - HTTP status code
 * @param meta - Additional metadata
 * @returns Problem+JSON compliant error object
 */
export function createVertexError(
  type: string,
  title: string,
  detail: string,
  status: number,
  meta?: Record<string, any>
): ProblemDetails {
  return {
    type: `urn:vertex:${type}`,
    title,
    detail,
    status,
    instance: crypto.randomUUID(),
    meta: {
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.GOOGLE_CLOUD_LOCATION,
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

/**
 * Parse and categorize Vertex AI errors
 * @param error - The error object from Vertex AI
 * @returns Categorized Problem+JSON error
 */
export async function parseVertexError(error: any): Promise<ProblemDetails> {
  const log = createOperationLogger('parseVertexError');
  
  // Check if the error response is HTML (non-JSON)
  if (error?.response && typeof error.response === 'string') {
    const responseStr = error.response.toString();
    
    // Detect HTML response
    if (responseStr.includes('<!DOCTYPE') || responseStr.includes('<html')) {
      // Save HTML artifact for debugging
      const artifactPath = await saveHtmlErrorArtifact(responseStr, 'html_error');
      
      return createVertexError(
        'html-error-response',
        'Non-JSON Error Response',
        'Vertex AI returned HTML error page instead of JSON. This typically indicates a service outage or authentication issue.',
        503,
        {
          artifactPath,
          firstBytes: responseStr.slice(0, 100)
        }
      );
    }
  }
  
  // Handle specific Vertex AI errors
  if (error?.status === 404 || error?.message?.includes('NOT_FOUND')) {
    const isModelNotFound = error?.message?.includes('Publisher Model') || 
                           error?.message?.includes('was not found');
    
    return createVertexError(
      isModelNotFound ? 'model-entitlement' : 'model-not-found',
      isModelNotFound ? 'Model Entitlement Required' : 'Model Not Found',
      isModelNotFound 
        ? `Project ${env.GOOGLE_CLOUD_PROJECT} lacks entitlement to Gemini models in ${env.GOOGLE_CLOUD_LOCATION}. Contact Google Cloud support to enable access.`
        : `Model not available in ${env.GOOGLE_CLOUD_LOCATION} for project ${env.GOOGLE_CLOUD_PROJECT}`,
      404,
      {
        model: 'gemini-1.5-flash',
        action: isModelNotFound ? 'Request entitlement from Google Cloud support' : 'Check model availability'
      }
    );
  }
  
  if (error?.status === 403 || error?.message?.includes('PERMISSION_DENIED')) {
    return createVertexError(
      'permission-denied',
      'Permission Denied',
      `IAM permission denied for Vertex AI in project ${env.GOOGLE_CLOUD_PROJECT}`,
      403,
      {
        requiredRole: 'roles/aiplatform.user'
      }
    );
  }
  
  // Handle rate limiting
  if (error?.status === 429 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
    return createVertexError(
      'rate-limit',
      'Rate Limit Exceeded',
      'Vertex AI rate limit exceeded. Reduce concurrency or wait before retrying.',
      429,
      {
        suggestion: 'Reduce NN_MAX_CONCURRENCY to 1 or 2'
      }
    );
  }
  
  // Handle service unavailable
  if (error?.status === 503 || error?.message?.includes('SERVICE_UNAVAILABLE')) {
    return createVertexError(
      'service-unavailable',
      'Service Temporarily Unavailable',
      'Vertex AI service is temporarily unavailable. Please try again later.',
      503,
      {}
    );
  }
  
  // Generic API error
  if (error?.status || error?.code) {
    return createVertexError(
      'api-error',
      'Vertex AI API Error',
      error?.message || 'Unknown error occurred',
      error?.status || 500,
      {
        errorCode: error?.code,
        originalError: error?.message
      }
    );
  }
  
  // Unknown error
  return createVertexError(
    'unknown-error',
    'Unknown Error',
    'An unexpected error occurred',
    500,
    {
      error: error?.message || String(error)
    }
  );
}

/**
 * Log a Problem+JSON error with appropriate severity
 * @param log - Logger instance
 * @param error - Problem+JSON error object
 */
export function logProblemError(
  log: ReturnType<typeof createOperationLogger>,
  error: ProblemDetails
): void {
  const logData = {
    type: error.type,
    status: error.status,
    detail: error.detail,
    meta: error.meta
  };
  
  if (error.status >= 500) {
    log.error(logData, error.title);
  } else if (error.status >= 400) {
    log.warn(logData, error.title);
  } else {
    log.info(logData, error.title);
  }
}