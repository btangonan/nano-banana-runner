import { VertexAI } from '@google-cloud/vertexai';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createOperationLogger, logTiming } from '../logger.js';
import { env, validateGoogleCloudConfig } from '../config/env.js';
import { FileSystemManifest } from '../adapters/fs-manifest.js';
import { tapRequestResponse } from '../lib/debugTap.js';

interface ProbeResult {
  auth: 'ok' | 'failed';
  project: string | null;
  location: string | null;
  model: 'reachable' | 'unreachable' | 'unknown';
  timestamp: string;
  errors?: string[];
}

const PROBE_CACHE_FILE = join(env.NN_OUT_DIR, 'probe.ok');
const PROBE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a recent probe.ok exists
 */
export async function hasRecentProbe(): Promise<boolean> {
  try {
    await access(PROBE_CACHE_FILE);
    const content = await readFile(PROBE_CACHE_FILE, 'utf-8');
    const probe = JSON.parse(content) as ProbeResult;
    
    const probeTime = new Date(probe.timestamp).getTime();
    const now = Date.now();
    
    return (now - probeTime) < PROBE_CACHE_DURATION && probe.auth === 'ok' && probe.model === 'reachable';
  } catch {
    return false;
  }
}

/**
 * Probe Vertex AI connectivity and model availability
 */
export async function runProbe(): Promise<ProbeResult> {
  const log = createOperationLogger('runProbe');
  const startTime = Date.now();
  
  const result: ProbeResult = {
    auth: 'failed',
    project: null,
    location: null,
    model: 'unknown',
    timestamp: new Date().toISOString(),
    errors: []
  };
  
  log.info('Starting Vertex AI connectivity probe');
  
  try {
    // Step 1: Validate environment configuration
    try {
      validateGoogleCloudConfig();
      result.project = env.GOOGLE_CLOUD_PROJECT || null;
      result.location = env.GOOGLE_CLOUD_LOCATION;
      log.info({ project: result.project, location: result.location }, 'Environment configuration valid');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors!.push(`Environment validation failed: ${message}`);
      log.error({ error }, 'Environment validation failed');
      return result;
    }
    
    // Step 2: Test ADC authentication
    try {
      // Attempt to initialize Vertex AI client
      new VertexAI({
        project: result.project!,
        location: result.location!
      });
      
      result.auth = 'ok';
      log.info('ADC authentication successful');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors!.push(`ADC authentication failed: ${message}`);
      log.error({ error }, 'ADC authentication failed');
      return result;
    }
    
    // Step 3: Test model reachability with minimal call
    try {
      const vertex = new VertexAI({
        project: result.project!,
        location: result.location!
      });
      
      // Get the model we intend to use
      const model = vertex.preview.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          maxOutputTokens: 10,  // Minimal to reduce cost
          temperature: 0.1,
        }
      });
      
      // Make a minimal test call
      const testRequest = {
        contents: [{
          role: 'user',
          parts: [{ text: 'Test probe. Reply with "ok" only.' }]
        }]
      };
      
      // Tap the request if debug is enabled
      await tapRequestResponse(testRequest, null, 'probe');
      
      // Attempt to generate (this validates the model is reachable)
      const response = await model.generateContent(testRequest);
      
      // Tap the response if debug is enabled
      await tapRequestResponse(null, response, 'probe');
      
      if (response && response.candidates && response.candidates.length > 0) {
        result.model = 'reachable';
        log.info('Model is reachable and responding');
      } else {
        result.model = 'unreachable';
        result.errors!.push('Model returned empty response');
        log.warn('Model returned empty response');
      }
      
    } catch (error: any) {
      result.model = 'unreachable';
      const message = error?.message || error?.toString() || 'Unknown error';
      
      // Check for specific error patterns
      if (message.includes('not found') || message.includes('does not exist')) {
        result.errors!.push(`Model not found: ${message}`);
        log.error('Model does not exist or is not accessible');
      } else if (message.includes('permission') || message.includes('403')) {
        result.errors!.push(`Permission denied: ${message}`);
        log.error('Insufficient permissions to access model');
      } else if (message.includes('quota') || message.includes('429')) {
        result.errors!.push(`Quota exceeded: ${message}`);
        log.error('API quota exceeded');
      } else {
        result.errors!.push(`Model test failed: ${message}`);
        log.error({ error }, 'Model reachability test failed');
      }
    }
    
    // Step 4: Write probe result
    const manifest = new FileSystemManifest();
    
    if (result.auth === 'ok' && result.model === 'reachable') {
      // Write success cache file
      await manifest.writeAtomic(PROBE_CACHE_FILE, JSON.stringify(result, null, 2));
      log.info({ cachePath: PROBE_CACHE_FILE }, 'Probe successful, cache written');
      
      // Also record in manifest
      await manifest.recordSuccess('probe', 'vertex-ai', PROBE_CACHE_FILE, {
        project: result.project,
        location: result.location,
        model: 'gemini-1.5-flash'
      });
    } else {
      // Record failure in manifest
      await manifest.recordProblem('probe', 'vertex-ai', {
        type: 'about:blank',
        title: 'Vertex AI probe failed',
        detail: result.errors?.join('; ') || 'Unknown error',
        status: 503,
        instance: crypto.randomUUID()
      });
    }
    
    logTiming(log, 'runProbe', startTime);
    
    // Print result summary
    console.log('\n🔍 Probe Results:');
    console.log(`   Authentication: ${result.auth === 'ok' ? '✅' : '❌'} ${result.auth}`);
    console.log(`   Project: ${result.project || 'Not configured'}`);
    console.log(`   Location: ${result.location || 'Not configured'}`);
    console.log(`   Model: ${result.model === 'reachable' ? '✅' : '❌'} ${result.model}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.forEach(err => console.log(`   - ${err}`));
    }
    
    if (result.auth === 'ok' && result.model === 'reachable') {
      console.log('\n✅ Probe successful! Ready for live operations.');
      console.log(`   Cache valid for 24 hours at: ${PROBE_CACHE_FILE}`);
    } else {
      console.log('\n❌ Probe failed. Please address the errors above before attempting live operations.');
    }
    
    return result;
    
  } catch (error) {
    log.error({ error }, 'Probe workflow failed unexpectedly');
    result.errors!.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return result;
  }
}