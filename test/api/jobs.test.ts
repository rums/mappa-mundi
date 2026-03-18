/**
 * Tests for GET /api/jobs/:jobId — Job Polling (Behavior 2)
 *
 * AC covered:
 *  2. GET /api/jobs/:jobId returns job status (running/completed/failed)
 *  3. Completed scan job result contains a valid SemanticMap
 * 13. Unknown jobId → 404
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('GET /api/jobs/:jobId', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return running status for an in-progress job', async () => {
    // Start a scan to get a jobId
    const scanResponse = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() },
    });
    const { jobId } = scanResponse.json();

    // Poll immediately — should be running (or queued)
    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('jobId', jobId);
    expect(body).toHaveProperty('status');
    expect(['queued', 'running']).toContain(body.status);
    expect(body).toHaveProperty('startedAt');
  });

  it('should return completed status with SemanticMap result when scan finishes', async () => {
    // Start a scan
    const scanResponse = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: process.cwd() },
    });
    const { jobId } = scanResponse.json();

    // Wait for completion by polling (with a reasonable timeout)
    let body: any;
    const deadline = Date.now() + 30_000;
    do {
      const response = await app.inject({
        method: 'GET',
        url: `/api/jobs/${jobId}`,
      });
      body = response.json();
      if (body.status === 'completed' || body.status === 'failed') break;
      await new Promise(r => setTimeout(r, 200));
    } while (Date.now() < deadline);

    expect(body.status).toBe('completed');
    expect(body).toHaveProperty('result');
    // SemanticMap should contain a top-level zoom with regions
    expect(body.result).toHaveProperty('id');
    expect(body.result).toHaveProperty('regions');
    expect(Array.isArray(body.result.regions)).toBe(true);
  });

  it('should return failed status with error message when scan fails', async () => {
    // Trigger a scan that will fail (e.g., a directory with no .ts/.js files)
    // We use a temp dir or mock scenario
    const scanResponse = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { projectPath: '/tmp' }, // valid dir, but no .ts/.js files
    });

    // If the server validates upfront, it returns 400; otherwise, poll for failure
    if (scanResponse.statusCode === 202) {
      const { jobId } = scanResponse.json();

      let body: any;
      const deadline = Date.now() + 10_000;
      do {
        const response = await app.inject({
          method: 'GET',
          url: `/api/jobs/${jobId}`,
        });
        body = response.json();
        if (body.status === 'completed' || body.status === 'failed') break;
        await new Promise(r => setTimeout(r, 200));
      } while (Date.now() < deadline);

      expect(body.status).toBe('failed');
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    } else {
      // Path validation caught it upfront — also acceptable
      expect(scanResponse.statusCode).toBe(400);
    }
  });

  it('should return 404 for an unknown jobId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/jobs/nonexistent-job-id-12345',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('should return 404 for an expired job (TTL exceeded)', async () => {
    // This test verifies the 5-minute TTL cleanup.
    // We rely on the app exposing a way to fast-forward time or we use vi.useFakeTimers.
    vi.useFakeTimers();
    try {
      const freshApp = await createApp();

      // Start and complete a scan (mock or real)
      const scanResponse = await freshApp.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { projectPath: process.cwd() },
      });
      const { jobId } = scanResponse.json();

      // Advance time past the 5-minute TTL
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      const response = await freshApp.inject({
        method: 'GET',
        url: `/api/jobs/${jobId}`,
      });

      expect(response.statusCode).toBe(404);
      await freshApp.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
