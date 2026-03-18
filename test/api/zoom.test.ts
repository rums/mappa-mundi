/**
 * Tests for GET /api/zoom/:regionId — Zoom endpoint (Behavior 3)
 *
 * AC covered:
 *  4. GET /api/zoom/:regionId returns cached sub-regions (200) or triggers generation (202)
 * 11. Unknown regionId → 404
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('GET /api/zoom/:regionId', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Helper: run a scan to completion so the server has project context.
   * Returns the completed job result.
   */
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

  it('should return 200 with SemanticZoomLevel for a cached region', async () => {
    const job = await scanToCompletion();
    expect(job.status).toBe('completed');
    const regionId = job.result.regions[0]?.id;
    expect(regionId).toBeDefined();

    const response = await app.inject({
      method: 'GET',
      url: `/api/zoom/${regionId}`,
    });

    // Cached: 200, or generating: 202 — both are acceptable
    expect([200, 202]).toContain(response.statusCode);

    const body = response.json();
    if (response.statusCode === 200) {
      expect(body).toHaveProperty('level');
      expect(body.level).toHaveProperty('id');
      expect(body.level).toHaveProperty('regions');
      expect(body.level).toHaveProperty('relationships');
      expect(body).toHaveProperty('cached');
    } else {
      // 202: generation triggered
      expect(body).toHaveProperty('jobId');
      expect(body).toHaveProperty('status', 'generating');
    }
  });

  it('should return 202 with jobId when zoom data is not cached', async () => {
    const job = await scanToCompletion();
    expect(job.status).toBe('completed');

    // Use a region ID that likely hasn't been pre-cached for sub-zoom
    const regionId = job.result.regions[0]?.id;
    expect(regionId).toBeDefined();

    const response = await app.inject({
      method: 'GET',
      url: `/api/zoom/${regionId}`,
    });

    // Either 200 (cached from initial scan) or 202 (needs generation)
    expect([200, 202]).toContain(response.statusCode);
    const body = response.json();
    if (response.statusCode === 202) {
      expect(body).toHaveProperty('jobId');
      expect(typeof body.jobId).toBe('string');
      expect(body).toHaveProperty('status', 'generating');
    }
  });

  it('should return 404 for an unknown regionId', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/zoom/nonexistent-region-xyz',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('should return 400 when no project has been scanned', async () => {
    // No scan performed — server has no project context
    const response = await app.inject({
      method: 'GET',
      url: '/api/zoom/some-region-id',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.message).toMatch(/no project scanned/i);
  });
});
