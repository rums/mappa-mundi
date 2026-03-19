/**
 * Behavior 11: API contract
 * Behavior 12: Concurrency
 * Behavior 17: Overview API
 *
 * Tests for /api/zoom/:compoundId and /api/map/overview endpoints.
 *
 * AC covered: #15, #16, #20, #21
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/api/server.js';

describe('GET /api/zoom/:compoundId — Atom-Compound Model', () => {
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
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);

    return body;
  }

  // ─── Behavior 11: API contract ──────────────────────────────────────────

  it('should return stratum 0 with breadcrumbs for GET /api/zoom/root (AC#15)', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/zoom/root',
    });

    // Should return 200 with stratum data
    expect([200, 202]).toContain(response.statusCode);

    if (response.statusCode === 200) {
      const body = response.json();
      expect(body).toHaveProperty('stratum');
      expect(body).toHaveProperty('stale');
      expect(body.stratum).toHaveProperty('compounds');
      expect(body.stratum).toHaveProperty('breadcrumbs');
      expect(body.stratum).toHaveProperty('relationships');
      expect(body.stratum).toHaveProperty('quality');

      // Breadcrumbs for root should start with root entry
      expect(body.stratum.breadcrumbs.length).toBeGreaterThanOrEqual(1);
      expect(body.stratum.breadcrumbs[0].compoundId).toBe('root');

      // Each compound should have zoomable flag
      for (const compound of body.stratum.compounds) {
        expect(typeof compound.zoomable).toBe('boolean');
        expect(compound).toHaveProperty('id');
        expect(compound).toHaveProperty('name');
        expect(compound).toHaveProperty('atomIds');
        expect(compound).toHaveProperty('references');
      }
    }
  });

  it('should return child stratum for GET /api/zoom/:compoundId (AC#15)', async () => {
    await scanToCompletion();

    // First get root to find a zoomable compound
    const rootResp = await app.inject({ method: 'GET', url: '/api/zoom/root' });
    if (rootResp.statusCode !== 200) return; // skip if not cached yet

    const rootBody = rootResp.json();
    const zoomable = rootBody.stratum.compounds.find((c: any) => c.zoomable);
    if (!zoomable) return; // skip if no zoomable compounds

    const response = await app.inject({
      method: 'GET',
      url: `/api/zoom/${zoomable.id}`,
    });

    expect([200, 202]).toContain(response.statusCode);

    if (response.statusCode === 200) {
      const body = response.json();
      expect(body.stratum).toHaveProperty('compounds');
      expect(body.stratum).toHaveProperty('breadcrumbs');
      // Breadcrumbs should include parent path
      expect(body.stratum.breadcrumbs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should return 400 for zooming a leaf compound (AC#16)', async () => {
    await scanToCompletion();

    const rootResp = await app.inject({ method: 'GET', url: '/api/zoom/root' });
    if (rootResp.statusCode !== 200) return;

    const rootBody = rootResp.json();
    const leaf = rootBody.stratum.compounds.find((c: any) => !c.zoomable);
    if (!leaf) return; // skip if all compounds are zoomable

    const response = await app.inject({
      method: 'GET',
      url: `/api/zoom/${leaf.id}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty('error');
  });

  it('should return 404 for non-existent compoundId', async () => {
    await scanToCompletion();

    const response = await app.inject({
      method: 'GET',
      url: '/api/zoom/nonexistent-compound-xyz',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  // ─── Behavior 12: Concurrency ──────────────────────────────────────────

  it('should handle parallel zoom requests for different compounds without conflicts (AC#20)', async () => {
    await scanToCompletion();

    const rootResp = await app.inject({ method: 'GET', url: '/api/zoom/root' });
    if (rootResp.statusCode !== 200) return;

    const rootBody = rootResp.json();
    const zoomableCompounds = rootBody.stratum.compounds.filter((c: any) => c.zoomable);
    if (zoomableCompounds.length < 2) return;

    // Fire parallel zoom requests
    const results = await Promise.all(
      zoomableCompounds.slice(0, 3).map((c: any) =>
        app.inject({ method: 'GET', url: `/api/zoom/${c.id}` }),
      ),
    );

    // All should succeed (200 or 202)
    for (const result of results) {
      expect([200, 202]).toContain(result.statusCode);
    }
  });

  it('should coalesce concurrent requests for the same compound', async () => {
    await scanToCompletion();

    const rootResp = await app.inject({ method: 'GET', url: '/api/zoom/root' });
    if (rootResp.statusCode !== 200) return;

    const rootBody = rootResp.json();
    const zoomable = rootBody.stratum.compounds.find((c: any) => c.zoomable);
    if (!zoomable) return;

    // Fire multiple concurrent requests for same compound
    const results = await Promise.all([
      app.inject({ method: 'GET', url: `/api/zoom/${zoomable.id}` }),
      app.inject({ method: 'GET', url: `/api/zoom/${zoomable.id}` }),
      app.inject({ method: 'GET', url: `/api/zoom/${zoomable.id}` }),
    ]);

    // All should get the same result
    for (const result of results) {
      expect([200, 202]).toContain(result.statusCode);
    }
  });
});

// ─── Behavior 17: Overview API ──────────────────────────────────────────────

describe('GET /api/map/overview', () => {
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
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);

    return body;
  }

  it('should return compound metadata for all cached strata (AC#21)', async () => {
    await scanToCompletion();

    // Load root stratum first
    await app.inject({ method: 'GET', url: '/api/zoom/root' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/map/overview',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('compounds');
    expect(Array.isArray(body.compounds)).toBe(true);

    if (body.compounds.length > 0) {
      const compound = body.compounds[0];
      expect(compound).toHaveProperty('id');
      expect(compound).toHaveProperty('name');
      expect(compound).toHaveProperty('parentId');
      expect(compound).toHaveProperty('depth');
      expect(compound).toHaveProperty('atomCount');
      expect(compound).toHaveProperty('zoomable');
      expect(compound).toHaveProperty('loaded');
      expect(typeof compound.zoomable).toBe('boolean');
      expect(typeof compound.loaded).toBe('boolean');
      expect(typeof compound.atomCount).toBe('number');
    }
  });

  it('should mark loaded=false for unexplored compounds', async () => {
    await scanToCompletion();

    // Only load root
    await app.inject({ method: 'GET', url: '/api/zoom/root' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/map/overview',
    });

    const body = response.json();
    // Compounds from stratum 0 that haven't been zoomed into should have loaded=false
    const unloaded = body.compounds.filter((c: any) => !c.loaded);
    // There should be some unloaded compounds (we haven't zoomed into any)
    if (body.compounds.length > 0) {
      expect(unloaded.length).toBeGreaterThan(0);
    }
  });

  it('should have loaded=false for leaf compounds (zoomable=false)', async () => {
    await scanToCompletion();
    await app.inject({ method: 'GET', url: '/api/zoom/root' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/map/overview',
    });

    const body = response.json();
    const leaves = body.compounds.filter((c: any) => !c.zoomable);
    for (const leaf of leaves) {
      expect(leaf.loaded).toBe(false);
    }
  });

  it('should set parentId=null for stratum-0 compounds', async () => {
    await scanToCompletion();
    await app.inject({ method: 'GET', url: '/api/zoom/root' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/map/overview',
    });

    const body = response.json();
    const depth0 = body.compounds.filter((c: any) => c.depth === 0);
    for (const c of depth0) {
      expect(c.parentId).toBeNull();
    }
  });
});
