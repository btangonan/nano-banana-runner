import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ReferencePack } from '../types/refs.js';
import { createOperationLogger } from '../logger.js';
import { createProblem } from '../types.js';

const log = createOperationLogger('loadReferencePack');

/**
 * Normalize shorthand notation in reference pack
 * Converts string paths to full objects
 */
function normalize(obj: any): any {
  const normalized = { ...obj };
  
  // Style: ["path.jpg"] → [{path: "path.jpg"}]
  if (Array.isArray(normalized.style)) {
    normalized.style = normalized.style.map((item: any) => 
      typeof item === 'string' ? { path: item } : item
    );
  }
  
  // Pose: ["path.jpg"] → [{path: "path.jpg"}]
  if (Array.isArray(normalized.pose)) {
    normalized.pose = normalized.pose.map((item: any) => 
      typeof item === 'string' ? { path: item } : item
    );
  }
  
  // Environment: ["path.jpg"] → [{path: "path.jpg"}]
  if (Array.isArray(normalized.environment)) {
    normalized.environment = normalized.environment.map((item: any) => 
      typeof item === 'string' ? { path: item } : item
    );
  }
  
  // Props: handle label shorthand
  // {"red_umbrella": "path.jpg"} → [{label: "red_umbrella", path: "path.jpg"}]
  if (normalized.props && !Array.isArray(normalized.props)) {
    const propsArray = [];
    for (const [label, value] of Object.entries(normalized.props)) {
      if (typeof value === 'string') {
        propsArray.push({ label, path: value });
      } else if (typeof value === 'object') {
        propsArray.push({ label, ...value });
      }
    }
    normalized.props = propsArray;
  }
  
  // Subject: handle name shorthand
  // {"alex": "face.jpg"} → [{name: "alex", face: "face.jpg"}]
  if (normalized.subject && !Array.isArray(normalized.subject)) {
    const subjectArray = [];
    for (const [name, value] of Object.entries(normalized.subject)) {
      if (typeof value === 'string') {
        subjectArray.push({ name, face: value });
      } else if (typeof value === 'object') {
        subjectArray.push({ name, ...value });
      }
    }
    normalized.subject = subjectArray;
  }
  
  // Add default version if missing
  if (!normalized.version) {
    normalized.version = '1.0';
  }
  
  return normalized;
}

/**
 * Load and parse reference pack from YAML or JSON file
 */
export async function loadReferencePack(filePath: string): Promise<ReferencePack> {
  log.debug({ filePath }, 'Loading reference pack');
  
  try {
    // Read file content
    const content = await readFile(filePath, 'utf-8');
    
    if (!content || content.trim().length === 0) {
      throw new Error('Reference pack file is empty');
    }
    
    // Determine format by extension
    const ext = extname(filePath).toLowerCase();
    let parsed: any;
    
    if (ext === '.yaml' || ext === '.yml') {
      // Dynamic import for YAML parser (optional dependency)
      try {
        const yaml = await import('yaml');
        parsed = yaml.parse(content);
      } catch (error) {
        log.error({ error }, 'YAML parser not available');
        throw new Error(
          'YAML parser not available. Install with: pnpm add yaml'
        );
      }
    } else if (ext === '.json') {
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        throw new Error(`Invalid JSON in reference pack: ${error}`);
      }
    } else {
      throw new Error(
        `Unsupported reference pack format: ${ext}. Use .json or .yaml`
      );
    }
    
    // Normalize shorthand notations
    const normalized = normalize(parsed);
    
    // Validate with Zod schema
    const result = ReferencePack.safeParse(normalized);
    
    if (!result.success) {
      const errors = result.error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid reference pack: ${errors}`);
    }
    
    // Count references for logging
    const counts = {
      style: result.data.style?.length ?? 0,
      props: result.data.props?.length ?? 0,
      subject: result.data.subject?.length ?? 0,
      pose: result.data.pose?.length ?? 0,
      environment: result.data.environment?.length ?? 0
    };
    
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    
    log.info({ 
      filePath, 
      version: result.data.version,
      counts,
      total 
    }, 'Reference pack loaded successfully');
    
    return result.data;
    
  } catch (error) {
    log.error({ filePath, error }, 'Failed to load reference pack');
    
    // Return as Problem+JSON compatible error
    if (error instanceof Error) {
      throw createProblem(
        'Reference pack load failed',
        error.message,
        400,
        'refs/load-error'
      );
    }
    throw error;
  }
}

/**
 * Calculate a digest hash for a reference pack
 * Used for tracking and deduplication
 */
export function getPackDigest(pack: ReferencePack): string {
  // Create a stable string representation
  const stable = JSON.stringify({
    version: pack.version,
    style: pack.style?.map(s => s.path).sort(),
    props: pack.props?.map(p => `${p.label}:${p.path}`).sort(),
    subject: pack.subject?.map(s => `${s.name}:${s.face}`).sort(),
    pose: pack.pose?.map(p => p.path).sort(),
    environment: pack.environment?.map(e => e.path).sort()
  });
  
  // Use crypto for hash
  const { createHash } = require('crypto');
  return createHash('sha256')
    .update(stable)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Get total reference count across all modes
 */
export function getTotalRefCount(pack: ReferencePack): number {
  return (
    (pack.style?.length ?? 0) +
    (pack.props?.length ?? 0) +
    (pack.subject?.length ?? 0) +
    (pack.pose?.length ?? 0) +
    (pack.environment?.length ?? 0)
  );
}

/**
 * Get active modes in a reference pack
 */
export function getActiveModes(pack: ReferencePack): string[] {
  const modes: string[] = [];
  
  if (pack.style && pack.style.length > 0) modes.push('style');
  if (pack.props && pack.props.length > 0) modes.push('props');
  if (pack.subject && pack.subject.length > 0) modes.push('subject');
  if (pack.pose && pack.pose.length > 0) modes.push('pose');
  if (pack.environment && pack.environment.length > 0) modes.push('environment');
  
  return modes;
}