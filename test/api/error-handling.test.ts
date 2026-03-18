/**
 * Tests for error handling — consistent error responses (Behavior 7)
 *
 * AC covered:
 * 15. All error responses follow consistent { error: { code, message } } format
 *
 * This file tests cross-cutting error handling concerns:
 * - Consistent error response shape
 * - Unhandled exceptions yield 500 with generic message
 * - Malformed request bodies yield 400
 * - CORS headers
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('Error handling', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return consistent error format for 400 errors', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(typeof body.error.code).toBe('string');
    expect(body.error).toHaveProperty('message');
    expect(typeof body.error.message).toBe('string');
    // Should NOT have a stack trace in the response
    expect(body.error).not.toHaveProperty('stack');
  });

  it('should return consistent error format for 404 errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/jobs/nonexistent-id',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('should return 404 for unknown API routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent-route',
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 400 for malformed JSON in POST body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      headers: { 'content-type': 'application/json' },
      payload: '{ invalid json',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
  });

  it('should never expose stack traces in error responses', async () => {
    // Test multiple error endpoints for stack trace leakage
    const endpoints = [
      { method: 'POST' as const, url: '/api/scan', payload: {} },
      { method: 'GET' as const, url: '/api/jobs/fake-id' },
      { method: 'GET' as const, url: '/api/zoom/fake-id' },
      { method: 'GET' as const, url: '/api/layers/fake-id' },
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject(endpoint);
      const body = response.json();
      if (body.error) {
        expect(body.error).not.toHaveProperty('stack');
        if (body.error.details) {
          expect(JSON.stringify(body.error.details)).not.toMatch(/at\s+\w+\s+\(/);
        }
      }
    }
  });
});

describe('CORS', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should include CORS headers for localhost origins', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/layers',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    // Should allow localhost origin
    const allowOrigin = response.headers['access-control-allow-origin'];
    expect(allowOrigin).toBeDefined();
  });

  it('should handle preflight requests for POST endpoints', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/scan',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });
});
