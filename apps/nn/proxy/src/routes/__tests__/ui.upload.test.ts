import { test, expect, beforeAll, afterAll } from '@jest/globals';
import { build } from '../test-helper.js';
import type { FastifyInstance } from 'fastify';

describe('Upload API Security Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
  });

  afterAll(async () => {
    await app.close();
  });

  test('rejects non-multipart requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ test: 'data' })
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.type).toBe('about:blank');
    expect(body.title).toContain('Invalid request');
  });

  test('handles empty upload gracefully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename=""',
        'Content-Type: application/octet-stream',
        '',
        '',
        '------boundary--'
      ].join('\r\n')
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uploaded).toBe(0);
    expect(body.files).toEqual([]);
  });

  test('validates file extension security', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename="test.exe"',
        'Content-Type: application/octet-stream',
        '',
        'fake exe content',
        '------boundary--'
      ].join('\r\n')
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uploaded).toBe(0);
    expect(body.warnings).toContain('Skipped file with unsupported extension: test.exe');
  });

  test('prevents path traversal in filenames', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename="../../../etc/passwd"',
        'Content-Type: image/jpeg',
        '',
        'fake jpeg content',
        '------boundary--'
      ].join('\r\n')
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uploaded).toBe(0);
    expect(body.warnings).toContain('Skipped file with invalid name: ../../../etc/passwd');
  });

  test('validates MIME type security', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename="test.jpg"',
        'Content-Type: application/javascript',
        '',
        'malicious js code',
        '------boundary--'
      ].join('\r\n')
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uploaded).toBe(0);
    expect(body.warnings).toContain('Skipped file with unsupported MIME type: test.jpg (application/javascript)');
  });

  test('enforces file size limits', async () => {
    // Create a large payload (16MB > 15MB limit)
    const largeContent = 'x'.repeat(16 * 1024 * 1024);
    
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename="large.jpg"',
        'Content-Type: image/jpeg',
        '',
        largeContent,
        '------boundary--'
      ].join('\r\n')
    });

    // Should either be rejected at plugin level or handled gracefully
    expect([200, 413, 400]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body.warnings).toContain(jasmine.stringMatching(/oversized file/));
    }
  });

  test('successful upload with valid image', async () => {
    // Mock a small JPEG header
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    
    const response = await app.inject({
      method: 'POST',
      url: '/ui/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary'
      },
      payload: [
        '------boundary',
        'Content-Disposition: form-data; name="files"; filename="test.jpg"',
        'Content-Type: image/jpeg',
        '',
        jpegHeader.toString('binary'),
        '------boundary--'
      ].join('\r\n')
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uploaded).toBe(1);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe('test.jpg');
    expect(body.files[0].path).toMatch(/^\.\/images\/[a-f0-9]+_test\.jpg$/);
  });
});