import { describe, it, expect } from 'vitest';

describe('Provider System Integration', () => {
  it('should pass basic smoke test', () => {
    expect(true).toBe(true);
  });
  
  it('should load provider modules without errors', async () => {
    // Basic module loading test
    const { createAnalyzeProvider } = await import('../../src/core/providers/factory.js');
    const { SharpProvider } = await import('../../src/core/providers/sharp.js');
    
    expect(createAnalyzeProvider).toBeDefined();
    expect(SharpProvider).toBeDefined();
  });
  
  it('should create Sharp provider', async () => {
    const { SharpProvider } = await import('../../src/core/providers/sharp.js');
    const provider = new SharpProvider();
    
    expect(provider.name).toBe('sharp');
    expect(provider.config).toBeDefined();
  });
  
  it('should create provider via factory', async () => {
    const { createAnalyzeProvider, DEFAULT_PROVIDER_CONFIG } = await import('../../src/core/providers/factory.js');
    const provider = createAnalyzeProvider(DEFAULT_PROVIDER_CONFIG);
    
    expect(provider.name).toBe('sharp');
    expect(typeof provider.analyze).toBe('function');
  });
});