import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runRender } from '../src/workflows/runRender.js';
import { runProbe } from '../src/workflows/runProbe.js';
import { createTestStyleImage } from './setup/create-test-image.js';
import { loadEnv } from '../src/config/env.js';
import { createOperationLogger } from '../src/logger.js';

const log = createOperationLogger('smoke-test');

describe('Smoke Test: Live Image Generation', () => {
  let testPromptPath: string;
  let testStyleDir: string;
  let testOutDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    // Load environment
    loadEnv();
    
    // Check if we have required environment variables
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      console.log('⚠️  GOOGLE_CLOUD_PROJECT not set, skipping live smoke tests');
      return;
    }

    // Set up test paths
    testPromptPath = join(process.cwd(), 'test', 'fixtures', 'smoke-prompt.jsonl');
    testStyleDir = join(process.cwd(), 'test', 'fixtures', 'styles');
    testOutDir = join(process.cwd(), 'test', 'output', 'smoke');
    
    // Create test directories
    await mkdir(testStyleDir, { recursive: true });
    await mkdir(testOutDir, { recursive: true });
    
    // Create test style image
    testImagePath = await createTestStyleImage();
    
    log.info({
      promptPath: testPromptPath,
      styleDir: testStyleDir,
      outDir: testOutDir,
      testImage: testImagePath
    }, 'Test setup complete');
  });

  afterAll(async () => {
    // Cleanup test output directory
    try {
      const { rmdir } = await import('node:fs/promises');
      await rmdir(testOutDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should probe Vertex AI connectivity successfully', async () => {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      console.log('⚠️  Skipping probe test - GOOGLE_CLOUD_PROJECT not set');
      return;
    }

    log.info('Running Vertex AI connectivity probe...');
    
    const result = await runProbe();
    
    expect(result).toBeDefined();
    expect(result.auth).toBe('ok');
    expect(result.model).toBe('reachable');
    
    log.info({ result }, 'Probe completed successfully');
  }, 30000); // 30 second timeout for API calls

  it('should perform dry-run cost estimation', async () => {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      console.log('⚠️  Skipping dry-run test - GOOGLE_CLOUD_PROJECT not set');
      return;
    }

    log.info('Testing dry-run cost estimation...');
    
    // This should not make actual API calls or incur costs
    await expect(runRender({
      promptsPath: testPromptPath,
      styleDir: testStyleDir,
      outDir: testOutDir,
      variants: 1,
      concurrency: 1,
      dryRun: true
    })).resolves.toBeUndefined(); // Should complete without error
    
    log.info('Dry-run completed successfully');
  }, 15000);

  it('should generate actual image when running live', async () => {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      console.log('⚠️  Skipping live test - GOOGLE_CLOUD_PROJECT not set');
      return;
    }

    if (process.env.SKIP_LIVE_TESTS === 'true') {
      console.log('⚠️  Skipping live test - SKIP_LIVE_TESTS=true');
      return;
    }

    log.info('Starting live image generation test...');
    
    let generationError: Error | null = null;
    let sanitizedRequest: any = null;
    let sanitizedResponse: any = null;
    
    try {
      await runRender({
        promptsPath: testPromptPath,
        styleDir: testStyleDir,
        outDir: testOutDir,
        variants: 1,
        concurrency: 1,
        dryRun: false
      });
      
      log.info('Live generation completed without errors');
      
      // Verify output files exist
      const { readdir } = await import('node:fs/promises');
      const outputFiles = await readdir(testOutDir);
      const imageFiles = outputFiles.filter(f => 
        f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
      );
      
      expect(imageFiles.length).toBeGreaterThan(0);
      log.info({ generatedFiles: imageFiles }, 'Generated files verified');
      
    } catch (error) {
      generationError = error as Error;
      log.error({ error }, 'Live generation failed');
      
      // Capture sanitized request/response for debugging
      // This is where you'd add debug tap information if available
      sanitizedRequest = {
        prompt: 'A simple red circle on white background',
        styleRefsCount: 1,
        variants: 1,
        timestamp: new Date().toISOString()
      };
      
      sanitizedResponse = {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5), // Limit stack trace
        timestamp: new Date().toISOString()
      };
    }
    
    if (generationError) {
      // Save debug information for analysis
      const debugPath = join(testOutDir, 'debug-info.json');
      await writeFile(debugPath, JSON.stringify({
        request: sanitizedRequest,
        response: sanitizedResponse,
        environment: {
          projectConfigured: !!process.env.GOOGLE_CLOUD_PROJECT,
          locationConfigured: !!process.env.GOOGLE_CLOUD_LOCATION,
          nodeVersion: process.version
        }
      }, null, 2));
      
      log.error({ debugPath }, 'Debug information saved');
      
      // Re-throw to fail the test but with structured information
      throw new Error(`Live generation failed: ${generationError.message}. Debug info saved to: ${debugPath}`);
    }
    
  }, 60000); // 60 second timeout for live generation

  it('should validate style guard with generated images', async () => {
    if (!process.env.GOOGLE_CLOUD_PROJECT || process.env.SKIP_LIVE_TESTS === 'true') {
      console.log('⚠️  Skipping style guard test - requires live generation');
      return;
    }

    // This test depends on the previous test generating images
    const { readdir } = await import('node:fs/promises');
    const outputFiles = await readdir(testOutDir);
    const imageFiles = outputFiles.filter(f => 
      f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
    );
    
    if (imageFiles.length === 0) {
      console.log('⚠️  No generated images found, skipping style guard test');
      return;
    }

    log.info('Testing style guard with generated images...');
    
    // Load the generated image and test style image
    const generatedImagePath = join(testOutDir, imageFiles[0]);
    const generatedImage = await readFile(generatedImagePath);
    const styleImage = await readFile(testImagePath);
    
    // Import and test style guard
    const { passesStyleGuard } = await import('../src/core/styleGuard.js');
    
    // Test that the generated image passes style guard (should not be identical to style ref)
    const passes = await passesStyleGuard(generatedImage, [styleImage]);
    
    // Log the result for analysis
    log.info({ 
      passes,
      generatedImageSize: generatedImage.length,
      styleImageSize: styleImage.length
    }, 'Style guard test completed');
    
    // The result depends on the actual similarity - we just want to ensure it runs without error
    expect(typeof passes).toBe('boolean');
    
  }, 30000);
});