import { readFile, writeFile, appendFile, mkdir, rename, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { 
  Manifest, 
  ManifestEntry, 
  Problem 
} from '../types.js';
import { createOperationLogger, logError } from '../logger.js';
import { env } from '../config/env.js';

/**
 * File system operations with atomic writes and manifest tracking
 */
export class FileSystemManifest {
  private manifestPath: string;
  private log = createOperationLogger('FileSystemManifest');

  constructor(manifestPath?: string) {
    this.manifestPath = manifestPath || join(env.NN_OUT_DIR, 'manifest.jsonl');
  }

  /**
   * Write file atomically (tmp -> rename)
   */
  async writeAtomic(filePath: string, content: string | Buffer): Promise<void> {
    const tmpPath = `${filePath}.tmp`;
    
    try {
      // Ensure directory exists
      await mkdir(dirname(filePath), { recursive: true });
      
      // Write to temporary file
      await writeFile(tmpPath, content);
      
      // Atomic rename
      await rename(tmpPath, filePath);
      
      this.log.debug({ filePath }, 'File written atomically');
      
    } catch (error) {
      // Clean up temp file on error
      try {
        await import('node:fs/promises').then(fs => fs.unlink(tmpPath));
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Read file with error handling
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Append entry to manifest JSONL
   */
  async appendManifestEntry(entry: ManifestEntry): Promise<void> {
    try {
      // Ensure manifest directory exists
      await mkdir(dirname(this.manifestPath), { recursive: true });
      
      // Append JSONL entry
      const line = JSON.stringify(entry) + '\n';
      await appendFile(this.manifestPath, line);
      
      this.log.debug({ operation: entry.operation, id: entry.id }, 
                     'Manifest entry appended');
      
    } catch (error) {
      logError(this.log, error, 'appendManifestEntry');
      throw error;
    }
  }

  /**
   * Record successful operation in manifest
   */
  async recordSuccess(
    operation: ManifestEntry['operation'],
    input: string,
    output: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: ManifestEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operation,
      input,
      output,
      status: 'success',
      metadata,
    };
    
    await this.appendManifestEntry(entry);
  }

  /**
   * Record failed operation with Problem+JSON in manifest
   */
  async recordProblem(
    operation: ManifestEntry['operation'],
    input: string,
    problem: Problem
  ): Promise<void> {
    const entry: ManifestEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      operation,
      input,
      output: '',
      status: 'failed',
      metadata: { problem },
    };
    
    await this.appendManifestEntry(entry);
  }

  /**
   * Read all manifest entries
   */
  async readManifestEntries(): Promise<ManifestEntry[]> {
    if (!await this.exists(this.manifestPath)) {
      return [];
    }
    
    const entries: ManifestEntry[] = [];
    const fileStream = createReadStream(this.manifestPath);
    const rl = createInterface({ input: fileStream });
    
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch (error) {
          this.log.warn({ line, error }, 'Invalid manifest entry, skipping');
        }
      }
    }
    
    return entries;
  }

  /**
   * Get manifest entries for specific operation
   */
  async getEntriesByOperation(
    operation: ManifestEntry['operation']
  ): Promise<ManifestEntry[]> {
    const allEntries = await this.readManifestEntries();
    return allEntries.filter(entry => entry.operation === operation);
  }

  /**
   * Get failed entries for retry
   */
  async getFailedEntries(): Promise<ManifestEntry[]> {
    const allEntries = await this.readManifestEntries();
    return allEntries.filter(entry => entry.status === 'failed');
  }

  /**
   * Write JSONL file atomically
   */
  async writeJSONL<T>(filePath: string, items: T[]): Promise<void> {
    const lines = items.map(item => JSON.stringify(item)).join('\n');
    await this.writeAtomic(filePath, lines);
  }

  /**
   * Read JSONL file
   */
  async readJSONL<T>(filePath: string): Promise<T[]> {
    const content = await this.readFile(filePath);
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  /**
   * Append item to JSONL file
   */
  async appendJSONL<T>(filePath: string, item: T): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });
    
    const line = JSON.stringify(item) + '\n';
    await appendFile(filePath, line);
  }

  /**
   * Write JSON file atomically
   */
  async writeJSON<T>(filePath: string, data: T): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await this.writeAtomic(filePath, content);
  }

  /**
   * Read JSON file
   */
  async readJSON<T>(filePath: string): Promise<T> {
    const content = await this.readFile(filePath);
    return JSON.parse(content);
  }

  /**
   * Create full manifest summary
   */
  async createManifest(): Promise<Manifest> {
    const entries = await this.readManifestEntries();
    const now = new Date().toISOString();
    
    return {
      version: '1.0.0',
      created: entries.length > 0 ? entries[0]!.timestamp : now,
      updated: now,
      entries,
    };
  }

  /**
   * Clean up temporary files in directory
   */
  async cleanupTempFiles(directory: string): Promise<void> {
    try {
      const { readdir, unlink } = await import('node:fs/promises');
      const files = await readdir(directory);
      
      const tempFiles = files.filter(f => f.endsWith('.tmp'));
      
      await Promise.allSettled(
        tempFiles.map(f => unlink(join(directory, f)))
      );
      
      if (tempFiles.length > 0) {
        this.log.info({ count: tempFiles.length, directory }, 
                      'Cleaned up temporary files');
      }
      
    } catch (error) {
      this.log.warn({ directory, error }, 'Failed to cleanup temp files');
    }
  }
}