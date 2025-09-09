import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probePublisherAccess } from '../../src/workflows/probePublisherAccess.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { env } from '../../src/config/env.js';

vi.mock('node:child_process');
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => vi.fn())
}));
vi.mock('node:fs/promises');

// Mock fetch globally
global.fetch = vi.fn();

describe('probePublisherAccess', () => {
  let mockExecAsync: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock exec async
    mockExecAsync = vi.fn().mockResolvedValue({ stdout: 'mock-access-token\n' });
    (promisify as any).mockReturnValue(mockExecAsync);
    
    // Mock fs operations
    (mkdir as any).mockResolvedValue(undefined);
    (writeFile as any).mockResolvedValue(undefined);
    (rename as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should probe all publisher models and return cache', async () => {
    // Mock successful responses for different models
    const mockResponses = [
      { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }, // gemini-2.5-flash-image-preview
      { status: 404, headers: new Headers({ 'content-type': 'application/json' }) }, // gemini-1.5-pro
      { status: 404, headers: new Headers({ 'content-type': 'application/json' }) }, // gemini-1.5-flash
      { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }, // textembedding-gecko
      { status: 404, headers: new Headers({ 'content-type': 'application/json' }) }, // text-bison
      { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }, // imagegeneration
    ];

    let fetchCallCount = 0;
    (global.fetch as any).mockImplementation(() => {
      const response = mockResponses[fetchCallCount];
      fetchCallCount++;
      return Promise.resolve(response);
    });

    const result = await probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    });

    // Verify structure
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('project', 'test-project');
    expect(result).toHaveProperty('location', 'us-central1');
    expect(result).toHaveProperty('results');
    expect(result.results).toHaveLength(6);

    // Verify model statuses
    expect(result.results[0]).toMatchObject({
      model: 'gemini-2.5-flash-image-preview',
      status: 'healthy',
      http: 200
    });

    expect(result.results[1]).toMatchObject({
      model: 'gemini-1.5-pro',
      status: 'degraded',
      http: 404,
      code: 'model-not-entitled'
    });

    expect(result.results[2]).toMatchObject({
      model: 'gemini-1.5-flash',
      status: 'degraded',
      http: 404,
      code: 'model-not-entitled'
    });

    expect(result.results[5]).toMatchObject({
      model: 'imagegeneration@005',
      status: 'healthy',
      http: 200
    });

    // Verify cache was written
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.any(String),
      'utf-8'
    );
    expect(rename).toHaveBeenCalled();
  });

  it('should handle network errors gracefully', async () => {
    // Mock network error
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    const result = await probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    });

    // All models should be marked as error
    expect(result.results).toHaveLength(6);
    result.results.forEach(model => {
      expect(model.status).toBe('error');
      expect(model.http).toBe(0);
      expect(model.code).toBe('network-error');
    });
  });

  it('should handle timeout errors', async () => {
    // Mock timeout by creating an AbortError
    const abortError = new Error('Request aborted');
    abortError.name = 'AbortError';
    (global.fetch as any).mockRejectedValue(abortError);

    const result = await probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    });

    // All models should be marked as timeout
    expect(result.results).toHaveLength(6);
    result.results.forEach(model => {
      expect(model.status).toBe('error');
      expect(model.http).toBe(0);
      expect(model.code).toBe('timeout');
    });
  });

  it('should handle missing GOOGLE_CLOUD_PROJECT', async () => {
    await expect(probePublisherAccess({
      location: 'us-central1'
    })).rejects.toThrow('GOOGLE_CLOUD_PROJECT is required');
  });

  it('should handle non-JSON responses', async () => {
    // Mock HTML error response
    (global.fetch as any).mockResolvedValue({
      status: 500,
      headers: new Headers({ 'content-type': 'text/html' })
    });

    const result = await probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    });

    // All models should be marked as error with non-json code
    expect(result.results).toHaveLength(6);
    result.results.forEach(model => {
      expect(model.status).toBe('error');
      expect(model.http).toBe(500);
      expect(model.code).toBe('non-json');
    });
  });

  it('should use default output path when not specified', async () => {
    (global.fetch as any).mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' })
    });

    await probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    });

    // Verify it wrote to the default location
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('artifacts/probe/publishers.json.tmp'),
      expect.any(String),
      'utf-8'
    );
  });

  it('should handle access token retrieval failure', async () => {
    // Mock exec failure
    mockExecAsync.mockRejectedValue(new Error('Command failed'));

    await expect(probePublisherAccess({
      project: 'test-project',
      location: 'us-central1'
    })).rejects.toThrow('Unable to get ADC access token');
  });
});