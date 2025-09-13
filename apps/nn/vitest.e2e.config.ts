import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // E2E test specific configuration
    name: 'e2e',
    root: resolve(__dirname),
    
    // Include only E2E test files
    include: [
      'test/e2e/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ],
    
    // Exclude unit tests
    exclude: [
      'node_modules/**',
      'test/unit/**',
      'test/providers/**',
      'test/adapters/**',
      'test/smoke.*'
    ],
    
    // E2E tests need more time
    testTimeout: 30000,
    hookTimeout: 30000,
    
    // Run tests in sequence for E2E (avoid rate limits)
    sequence: {
      concurrent: false
    },
    
    // Environment setup
    env: {
      // Default to mock mode for safety
      E2E_MODE: process.env.E2E_MODE || 'mock',
      E2E_BUDGET_USD: process.env.E2E_BUDGET_USD || '0.50',
      E2E_CASSETTES_DIR: process.env.E2E_CASSETTES_DIR || 'test/e2e/fixtures/recordings',
      E2E_VERSION_TAG: process.env.E2E_VERSION_TAG || 'gemini-2.5-flash-image-preview@2025-09',
      E2E_COST_REPORT_PATH: process.env.E2E_COST_REPORT_PATH || 'test/e2e/.artifacts/cost.json'
    },
    
    // Reporter configuration
    reporters: ['verbose'],
    
    // Output test results
    outputFile: {
      json: './test/e2e/.artifacts/results.json',
      html: './test/e2e/.artifacts/results.html'
    },
    
    // Setup files if needed
    setupFiles: [],
    
    // Global test utilities
    globals: true,
    
    // Coverage settings (optional for E2E)
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './test/e2e/.artifacts/coverage'
    }
  },
  
  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test')
    }
  }
});