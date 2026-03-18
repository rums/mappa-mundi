/**
 * Tests for POST /api/scan — Scan lifecycle (Behavior 1)
 *
 * AC covered:
 *  1. POST /api/scan with valid path returns 202 with jobId
 * 10. Invalid project path → 400 with descriptive error
 * 14. Scan already in progress + new scan request → 409 conflict
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

// ─── Behavior 1: Scan Lifecycle ─────────────────────────────────────────────

describe('POST /api/scan', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return 202 with jobId for a valid project path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() }, // use the repo itself as a valid project
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toHaveProperty('jobId');
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('status', 'queued');
  });

  it('should return 400 for a nonexistent path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: '/nonexistent/path/that/does/not/exist' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(typeof body.error.message).toBe('string');
  });

  it('should return 400 when projectPath points to a file, not a directory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: `${process.cwd()}/package.json` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('should return 400 when projectPath contains path traversal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: '../../etc/passwd' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toHaveProperty('code');
  });

  it('should return 400 when projectPath is missing from the request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
  });

  it('should return 400 for malformed JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      headers: { 'content-type': 'application/json' },
      payload: 'not valid json {{{',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
  });

  it('should return 409 when a scan is already in progress', async () => {
    // Start first scan
    const first = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() },
    });
    expect(first.statusCode).toBe(202);

    // Immediately request a second scan while first is running
    const second = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() },
    });

    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });
});
