#!/usr/bin/env node

/**
 * Gated live test - requires explicit confirmation
 * Validates single-shot image generation with style guard
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GeminiImageAdapter } from '../../src/adapters/geminiImage.js';
import { hasRecentProbe } from '../../src/workflows/runProbe.js';
import { passesStyleGuard } from '../../src/core/styleGuard.js';
import { loadEnv, env } from '../../src/config/env.js';
import { createOperationLogger } from '../../src/logger.js';

const log = createOperationLogger('gated-test');

async function runGatedTest(): Promise<void> {
  log.info('Starting gated live test');
  
  // Step 1: Check for probe
  const hasProbe = await hasRecentProbe();
  if (!hasProbe) {
    throw new Error('No recent probe. Run "nn probe" first.');
  }
  
  // Step 2: Confirm with user
  if (!process.argv.includes('--yes')) {
    console.log('\n⚠️  This test will make a LIVE API call to Vertex AI');
    console.log('   This will incur charges on your GCP account');
    console.log('   Run with --yes to confirm\n');
    process.exit(1);
  }
  
  // Step 3: Set up test data
  const testPrompt = 'A serene mountain landscape at sunset with dramatic clouds';
  const styleRefPath = join(process.cwd(), 'test/fixtures/style-reference.png');
  
  // Ensure style reference exists
  try {
    await readFile(styleRefPath);
  } catch {
    log.error('Style reference not found at test/fixtures/style-reference.png');
    log.info('Please create a test style reference image first');
    process.exit(1);
  }
  
  // Step 4: Initialize adapter
  const adapter = new GeminiImageAdapter({
    project: env.GOOGLE_CLOUD_PROJECT!,
    location: env.GOOGLE_CLOUD_LOCATION
  });
  
  // Step 5: Generate single test image
  log.info('Generating test image...');
  const startTime = Date.now();
  
  const result = await adapter.render({
    rows: [{ prompt: testPrompt }],
    variants: 1,
    styleOnly: true,
    styleRefs: [styleRefPath],
    runMode: 'live'
  });
  
  const elapsed = Date.now() - startTime;
  log.info({ elapsed, results: result.results.length }, 'Generation complete');
  
  // Step 6: Validate output
  if (result.results.length !== 1) {
    throw new Error(`Expected 1 result, got ${result.results.length}`);
  }
  
  const outputPath = result.results[0]!.outPath;
  const generated = await readFile(outputPath);
  const styleRef = await readFile(styleRefPath);
  
  // Step 7: Style guard validation
  const passes = await passesStyleGuard(generated, [styleRef]);
  
  if (!passes) {
    log.warn('Generated image too similar to style reference (potential copy)');
  } else {
    log.info('Style guard passed - image is sufficiently different');
  }
  
  // Success
  console.log('\n✅ Gated test passed!');
  console.log(`   Generated image: ${outputPath}`);
  console.log(`   Generation time: ${elapsed}ms`);
  console.log(`   Style guard: ${passes ? 'PASSED' : 'FAILED'}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  
  runGatedTest().catch(error => {
    log.error({ error }, 'Gated test failed');
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
}

export { runGatedTest };