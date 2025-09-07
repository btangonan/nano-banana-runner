import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { createOperationLogger } from '../logger.js';

/**
 * Debug tap for Vertex AI requests/responses
 * Enabled via NN_DEBUG_VERTEX=1 environment variable
 */

const DEBUG_DIR = join(env.NN_OUT_DIR, 'debug');
const MAX_BASE64_LENGTH = 2048; // Truncate large image data

/**
 * Patterns to redact from debug output
 */
const REDACTION_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~\+\/]+=*/gi,  // Bearer tokens
  /key["\s]*[:=]\s*["']?[A-Za-z0-9\-._~\+\/]+["']?/gi,  // API keys
  /token["\s]*[:=]\s*["']?[A-Za-z0-9\-._~\+\/]+["']?/gi,  // Tokens
  /authorization["\s]*[:=]\s*["']?[^"'\s]+["']?/gi,  // Auth headers
  /AIza[A-Za-z0-9\-._~\+\/]{35}/g,  // Google API keys pattern
];

/**
 * Check if debug tap is enabled
 */
export function isDebugEnabled(): boolean {
  return env.NN_DEBUG_VERTEX === true;
}

/**
 * Redact sensitive information from object
 */
function redactSensitive(obj: any): any {
  if (typeof obj === 'string') {
    let redacted = obj;
    for (const pattern of REDACTION_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item));
  }
  
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Truncate large base64 data
      if (key === 'data' && typeof value === 'string' && value.length > MAX_BASE64_LENGTH) {
        result[key] = `[TRUNCATED: ${value.length} bytes, first 100 chars: ${value.substring(0, 100)}...]`;
      }
      // Redact auth-related keys
      else if (/^(auth|token|key|secret|password|credential)/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitive(value);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Write debug snapshot to file
 */
async function writeDebugSnapshot(
  type: 'request' | 'response',
  data: any,
  operation: string
): Promise<void> {
  const log = createOperationLogger('debugTap');
  
  try {
    // Ensure debug directory exists
    await mkdir(DEBUG_DIR, { recursive: true });
    
    // Generate timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-${operation}-${type}.json`;
    const filepath = join(DEBUG_DIR, filename);
    
    // Redact and serialize
    const redacted = redactSensitive(data);
    const content = JSON.stringify(redacted, null, 2);
    
    // Write to file
    await writeFile(filepath, content);
    
    log.debug({ filepath, type, operation }, 'Debug snapshot written');
  } catch (error) {
    log.warn({ error }, 'Failed to write debug snapshot');
    // Don't throw - debug tap should not break the main flow
  }
}

/**
 * Tap a Vertex AI request
 */
export async function tapRequest(
  request: any,
  operation: string = 'vertex'
): Promise<void> {
  if (!isDebugEnabled()) return;
  await writeDebugSnapshot('request', request, operation);
}

/**
 * Tap a Vertex AI response
 */
export async function tapResponse(
  response: any,
  operation: string = 'vertex'
): Promise<void> {
  if (!isDebugEnabled()) return;
  await writeDebugSnapshot('response', response, operation);
}

/**
 * Tap both request and response
 */
export async function tapRequestResponse(
  request: any,
  response: any,
  operation: string = 'vertex'
): Promise<void> {
  if (!isDebugEnabled()) return;
  await Promise.all([
    tapRequest(request, operation),
    tapResponse(response, operation)
  ]);
}