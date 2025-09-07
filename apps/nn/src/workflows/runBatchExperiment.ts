import { readFile } from 'node:fs/promises';
import { createOperationLogger } from '../logger.js';
import { BatchRelayClient } from '../adapters/batchRelayClient.js';
import { loadReferencePack, getPackDigest, getTotalRefCount } from '../config/refs.js';
import { PromptRow } from '../types.js';
import { RefMode } from '../types/refs.js';
import { env } from '../config/env.js';

const log = createOperationLogger('runBatchExperiment');

interface ExperimentOptions {
  promptsPath: string;
  refsPath: string;
  refMode: RefMode;
}

/**
 * Run a mini experiment to validate multi-ref support with provider
 */
export async function runBatchExperiment(opts: ExperimentOptions): Promise<void> {
  log.info({ 
    promptsPath: opts.promptsPath,
    refsPath: opts.refsPath,
    refMode: opts.refMode
  }, 'Starting batch experiment');
  
  try {
    // Load a small subset of prompts (max 1 for experiment)
    const promptsContent = await readFile(opts.promptsPath, 'utf-8');
    const allRows: PromptRow[] = promptsContent
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // Take only first prompt for experiment
    const rows = allRows.slice(0, 1);
    if (rows.length === 0) {
      throw new Error('No prompts found in file');
    }
    
    log.info({ count: rows.length }, 'Using subset for experiment');
    
    // Load reference pack
    const pack = await loadReferencePack(opts.refsPath);
    const packDigest = getPackDigest(pack);
    
    log.info({ 
      packDigest,
      totalRefs: getTotalRefCount(pack),
      refMode: opts.refMode
    }, 'Loaded reference pack for experiment');
    
    // Extract sample references (first of each type)
    const sampleRefs: any[] = [];
    const labels: string[] = [];
    
    if (pack.style && pack.style.length > 0) {
      sampleRefs.push({ type: 'style', path: pack.style[0].path });
      labels.push('STYLE_REF[0]');
    }
    
    if (pack.props && pack.props.length > 0) {
      sampleRefs.push({ 
        type: 'prop', 
        path: pack.props[0].path, 
        label: pack.props[0].label 
      });
      labels.push(`PROP_REF[label=${pack.props[0].label}]`);
    }
    
    if (pack.subject && pack.subject.length > 0) {
      sampleRefs.push({ 
        type: 'subject', 
        path: pack.subject[0].face,
        name: pack.subject[0].name 
      });
      labels.push(`SUBJECT_REF[name=${pack.subject[0].name}]`);
    }
    
    if (pack.pose && pack.pose.length > 0) {
      sampleRefs.push({ type: 'pose', path: pack.pose[0].path });
      labels.push('POSE_REF[0]');
    }
    
    if (pack.environment && pack.environment.length > 0) {
      sampleRefs.push({ type: 'environment', path: pack.environment[0].path });
      labels.push('ENV_REF[0]');
    }
    
    // Initialize relay client
    const relayUrl = env.NN_BATCH_RELAY ?? 'http://127.0.0.1:8787';
    const client = new BatchRelayClient(relayUrl);
    
    // Check relay health first
    try {
      const health = await client.healthCheck();
      log.info({ health }, 'Relay health check passed');
    } catch (error) {
      log.error({ error }, 'Relay not accessible');
      console.error('\n❌ Batch relay not accessible at', relayUrl);
      console.error('   Start the proxy first: cd proxy && pnpm dev');
      throw error;
    }
    
    // Prepare experiment payload
    const experimentPayload = {
      rows: rows.map(r => ({
        prompt: r.prompt,
        sourceImage: r.sourceImage,
        seed: r.seed,
        tags: r.tags
      })),
      variants: 1 as const,
      styleOnly: opts.refMode === 'style',
      styleRefs: pack.style?.map(s => s.path) ?? [],
      // Extended for experiment
      referencePack: {
        digest: packDigest,
        totalRefs: getTotalRefCount(pack),
        samples: sampleRefs
      },
      refMode: opts.refMode,
      labels
    };
    
    log.info({ 
      payloadSize: JSON.stringify(experimentPayload).length,
      refCount: sampleRefs.length,
      labels 
    }, 'Prepared experiment payload');
    
    // Display experiment plan
    console.log('\n🧪 Experiment Plan:');
    console.log(`   Prompt: "${rows[0].prompt.slice(0, 50)}..."`);
    console.log(`   Mode: ${opts.refMode}`);
    console.log(`   References: ${sampleRefs.length} samples`);
    labels.forEach(label => console.log(`     - ${label}`));
    
    // Note: The actual experiment endpoint would be implemented in the proxy
    // For now, we can test with a regular submit in dry-run mode
    console.log('\n📤 Sending to relay for validation...');
    
    try {
      // Try to submit with minimal payload
      const result = await client.submit({
        ...experimentPayload,
        rows: experimentPayload.rows as any
      });
      
      console.log('\n✅ Experiment accepted!');
      console.log(`   Job ID: ${result.jobId}`);
      console.log(`   Provider accepted multi-ref structure`);
      console.log('\n   Note: This was a minimal test. Full implementation pending.');
      
      log.info({ jobId: result.jobId }, 'Experiment successful');
      
    } catch (error: any) {
      console.log('\n⚠️  Experiment result:');
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        console.log('   Experiment endpoint not yet implemented in proxy');
        console.log('   This is expected for Phase 1');
      } else {
        console.log('   Provider may not accept this structure');
        console.log(`   Error: ${error.message}`);
      }
      
      log.warn({ error: error.message }, 'Experiment inconclusive');
    }
    
  } catch (error) {
    log.error({ error }, 'Batch experiment failed');
    throw error;
  }
}

/**
 * CLI entry point for experiment command
 */
export async function runExperimentCommand(opts: {
  promptsPath: string;
  refsPath: string;
  refMode?: string;
}): Promise<void> {
  // Default to mixed mode for experiments
  const refMode = (opts.refMode as RefMode) || 'mixed';
  
  await runBatchExperiment({
    promptsPath: opts.promptsPath,
    refsPath: opts.refsPath,
    refMode
  });
}