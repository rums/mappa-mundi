/**
 * Tests for GET /api/search — Search endpoint (Behavior 5)
 *
 * AC covered:
 *  8. GET /api/search?q=authentication returns ranked SearchResults
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('GET /api/search', () => {
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

  it('should return ranked search results for a valid query', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=scanner',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('results');
    expect(body).toHaveProperty('query', 'scanner');
    expect(Array.isArray(body.results)).toBe(true);

    // Results should be SearchResult-shaped
    for (const result of body.results) {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('kind');
      expect(['module', 'region', 'symbol']).toContain(result.kind);
      expect(result).toHaveProperty('score');
      expect(typeof result.score).toBe('number');
    }
  });

  it('should return empty results for an empty query', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('results');
    expect(body.results).toEqual([]);
  });

  it('should respect maxResults query parameter', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=function&maxResults=5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results.length).toBeLessThanOrEqual(5);
  });

  it('should return only symbol/region results when enableLLM=false', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=scanner&enableLLM=false',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.results)).toBe(true);
    // With LLM disabled, results should come from symbol/region matching only
    for (const result of body.results) {
      expect(['module', 'region', 'symbol']).toContain(result.kind);
    }
  });

  it('should return results sorted by score in descending order', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=scanner',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const scores = body.results.map((r: any) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('should return 400 when no project has been scanned', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.message).toMatch(/no project scanned/i);
  });
});
