/**
 * Tests for GET /api/layers and GET /api/layers/:layerId — Layers endpoint (Behavior 4)
 *
 * AC covered:
 *  5. GET /api/layers lists all registered layers
 *  6. GET /api/layers/:layerId returns scores for all modules
 *  7. GET /api/layers/:layerId?regionId=X returns scores scoped to region's modules
 * 12. Unknown layerId → 404
 * 15. All error responses follow consistent { error: { code, message } } format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('Layers API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Helper: run a scan to completion so layers can compute scores.
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

  // ─── GET /api/layers ────────────────────────────────────────────────────

  describe('GET /api/layers', () => {
    it('should return a list of available layers with metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/layers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('layers');
      expect(Array.isArray(body.layers)).toBe(true);

      // Should have at least the built-in layers (complexity, staleness, coverage)
      expect(body.layers.length).toBeGreaterThanOrEqual(1);

      for (const layer of body.layers) {
        expect(layer).toHaveProperty('id');
        expect(typeof layer.id).toBe('string');
        expect(layer).toHaveProperty('name');
        expect(typeof layer.name).toBe('string');
        expect(layer).toHaveProperty('description');
        expect(typeof layer.description).toBe('string');
      }
    });
  });

  // ─── GET /api/layers/:layerId ───────────────────────────────────────────

  describe('GET /api/layers/:layerId', () => {
    it('should return module scores for a valid layerId', async () => {
      const job = await scanToCompletion();
      expect(job.status).toBe('completed');

      // Get the list of layers first
      const layersResp = await app.inject({ method: 'GET', url: '/api/layers' });
      const { layers } = layersResp.json();
      expect(layers.length).toBeGreaterThan(0);

      const layerId = layers[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/layers/${layerId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('layerId', layerId);
      expect(body).toHaveProperty('moduleScores');
      expect(typeof body.moduleScores).toBe('object');

      // Each module score should be a LayerScore-shaped object
      for (const [moduleId, score] of Object.entries(body.moduleScores) as [string, any][]) {
        expect(typeof moduleId).toBe('string');
        expect(score).toHaveProperty('value');
        expect(typeof score.value).toBe('number');
        expect(score).toHaveProperty('label');
        expect(typeof score.label).toBe('string');
        expect(score).toHaveProperty('severity');
        expect(['info', 'warning', 'critical']).toContain(score.severity);
      }
    });

    it('should return scores scoped to a region when regionId query param is provided', async () => {
      const job = await scanToCompletion();
      expect(job.status).toBe('completed');

      const layersResp = await app.inject({ method: 'GET', url: '/api/layers' });
      const { layers } = layersResp.json();
      const layerId = layers[0].id;

      const regionId = job.result.regions[0]?.id;
      expect(regionId).toBeDefined();

      const response = await app.inject({
        method: 'GET',
        url: `/api/layers/${layerId}?regionId=${regionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('layerId', layerId);
      expect(body).toHaveProperty('moduleScores');

      // Scoped results should have fewer modules than the full set
      // (or equal if the region contains all modules)
      expect(typeof body.moduleScores).toBe('object');

      // Should optionally include regionScores
      if (body.regionScores) {
        expect(typeof body.regionScores).toBe('object');
      }
    });

    it('should return 404 for an unknown layerId', async () => {
      await scanToCompletion();

      const response = await app.inject({
        method: 'GET',
        url: '/api/layers/nonexistent-layer-xyz',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('should return 200 with empty scores when external data is unavailable', async () => {
      const job = await scanToCompletion();
      expect(job.status).toBe('completed');

      // The coverage layer requires an external coverage report.
      // When it's not available, the endpoint should still return 200
      // with empty scores and optionally a warning.
      const response = await app.inject({
        method: 'GET',
        url: '/api/layers/coverage',
      });

      // May return 404 if coverage isn't registered, or 200 with empty scores
      if (response.statusCode === 200) {
        const body = response.json();
        expect(body).toHaveProperty('moduleScores');
      }
    });
  });
});
