/**
 * Tests for POST /api/refresh — Refresh endpoint (Behavior 6)
 *
 * AC covered:
 *  9. POST /api/refresh returns 202 and re-scans
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('POST /api/refresh', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function scanToCompletion() {
    const scanResp = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() },
    });
    const { jobId } = scanResp.json();

    let body: any;
    const deadline = Date.now() + 30_000;
    do {
      const resp = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
      body = resp.json();
      if (body.status === 'completed' || body.status === 'failed') break;
      await new Promise(r => setTimeout(r, 200));
    } while (Date.now() < deadline);

    return body;
  }

  it('should return 202 with jobId for a refresh after initial scan', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'POST',
      url: '/api/refresh',
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toHaveProperty('jobId');
    expect(typeof body.jobId).toBe('string');
    expect(body).toHaveProperty('status', 'queued');
  });

  it('should complete refresh and produce updated results', async () => {
    await scanToCompletion();

    const refreshResp = await app.inject({
      method: 'POST',
      url: '/api/refresh',
    });
    const { jobId } = refreshResp.json();

    // Wait for refresh to complete
    let body: any;
    const deadline = Date.now() + 30_000;
    do {
      const resp = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
      body = resp.json();
      if (body.status === 'completed' || body.status === 'failed') break;
      await new Promise(r => setTimeout(r, 200));
    } while (Date.now() < deadline);

    expect(body.status).toBe('completed');
    expect(body).toHaveProperty('result');
    expect(body.result).toHaveProperty('regions');
  });

  it('should return 400 when no initial scan has been performed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/refresh',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.message).toMatch(/no project scanned/i);
  });
});
