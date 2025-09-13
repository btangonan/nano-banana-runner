import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { env } from '../config/env.js';
import { createOperationLogger } from '../logger.js';

const execAsync = promisify(exec);
const log = createOperationLogger('probePublisherAccess');

interface PublisherModel {
  model: string;
  endpoint: 'generateContent' | 'predict';
  body: any;
}

interface ProbeResult {
  model: string;
  status: 'healthy' | 'degraded' | 'error';
  http: number;
  code?: string;
  timestamp: string;
  endpoint: string;
}

interface ProbeCache {
  timestamp: string;
  project: string;
  location: string;
  results: ProbeResult[];
}

/**
 * Publisher models to probe
 */
const PUBLISHER_MODELS: PublisherModel[] = [
  {
    model: 'gemini-2.5-flash-image-preview',
    endpoint: 'generateContent',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'probe' }] }]
    }
  },
  {
    model: 'gemini-1.5-pro',
    endpoint: 'generateContent',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'probe' }] }]
    }
  },
  {
    model: 'gemini-1.5-flash',
    endpoint: 'generateContent',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'probe' }] }]
    }
  },
  {
    model: 'textembedding-gecko@003',
    endpoint: 'predict',
    body: {
      instances: [{ content: 'probe' }]
    }
  },
  {
    model: 'text-bison@002',
    endpoint: 'predict',
    body: {
      instances: [{ prompt: 'probe' }],
      parameters: { temperature: 0.2 }
    }
  },
  {
    model: 'imagegeneration@005',
    endpoint: 'predict',
    body: {
      instances: [{ prompt: 'simple icon' }],
      parameters: { sampleCount: 1, size: '64x64' }
    }
  }
];

/**
 * Get ADC access token
 */
async function getAccessToken(): Promise<string> {
  try {
    const { stdout } = await execAsync('gcloud auth print-access-token', {
      timeout: 5000
    });
    return stdout.trim();
  } catch (error) {
    log.error({ error }, 'Failed to get access token');
    throw new Error('Unable to get ADC access token');
  }
}

/**
 * Probe a single publisher model
 */
async function probeModel(
  model: PublisherModel,
  token: string,
  project: string,
  location: string
): Promise<ProbeResult> {
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model.model}:${model.endpoint}`;
  
  log.debug({ model: model.model, endpoint }, 'Probing model');
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(model.body),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    
    if (response.status === 200) {
      return {
        model: model.model,
        status: 'healthy',
        http: 200,
        timestamp: new Date().toISOString(),
        endpoint
      };
    } else if (response.status === 404) {
      return {
        model: model.model,
        status: 'degraded',
        http: 404,
        code: 'model-not-entitled',
        timestamp: new Date().toISOString(),
        endpoint
      };
    } else {
      return {
        model: model.model,
        status: 'error',
        http: response.status,
        code: isJson ? 'error-json' : 'non-json',
        timestamp: new Date().toISOString(),
        endpoint
      };
    }
  } catch (error: any) {
    log.error({ model: model.model, error: error.message }, 'Probe failed');
    
    return {
      model: model.model,
      status: 'error',
      http: 0,
      code: error.name === 'AbortError' ? 'timeout' : 'network-error',
      timestamp: new Date().toISOString(),
      endpoint
    };
  }
}

/**
 * Probe all publisher models and cache results
 */
export async function probePublisherAccess(opts: {
  project?: string;
  location?: string;
  outputPath?: string;
}): Promise<ProbeCache> {
  const project = opts.project || env.GOOGLE_CLOUD_PROJECT;
  const location = opts.location || env.GOOGLE_CLOUD_LOCATION;
  const outputPath = opts.outputPath || join(env.NN_OUT_DIR, 'artifacts', 'probe', 'publishers.json');
  
  if (!project) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required for publisher probe');
  }
  
  log.info({ project, location }, 'Starting publisher model probe');
  
  // Get access token
  const token = await getAccessToken();
  
  // Probe all models
  const results: ProbeResult[] = [];
  for (const model of PUBLISHER_MODELS) {
    const result = await probeModel(model, token, project, location);
    results.push(result);
    
    log.info({ 
      model: result.model, 
      status: result.status, 
      http: result.http 
    }, 'Model probe completed');
  }
  
  // Prepare cache
  const cache: ProbeCache = {
    timestamp: new Date().toISOString(),
    project,
    location,
    results
  };
  
  // Write cache atomically
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
  await rename(tmpPath, outputPath);
  
  log.info({ 
    path: outputPath,
    healthy: results.filter(r => r.status === 'healthy').length,
    degraded: results.filter(r => r.status === 'degraded').length,
    error: results.filter(r => r.status === 'error').length
  }, 'Publisher probe cache written');
  
  // Print summary
  console.log('\nPublisher Model Probe Results:');
  console.log('================================');
  for (const result of results) {
    const icon = result.status === 'healthy' ? '✅' : 
                 result.status === 'degraded' ? '❌' : '⚠️';
    console.log(`${icon} ${result.model}: ${result.status} (HTTP ${result.http})`);
  }
  console.log('\nCache written to:', outputPath);
  
  return cache;
}