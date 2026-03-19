import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Fastify from 'fastify';
import { registerLensRoutes } from '../../src/api/routes/lenses.js';
import { LensStore } from '../../src/lenses/store.js';

describe('Lens API routes', () => {
  let app: ReturnType<typeof Fastify>;
  let storeDir: string;
  let store: LensStore;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `mappa-lens-api-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    store = new LensStore(storeDir);
    app = Fastify();
    registerLensRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (existsSync(storeDir)) rmSync(storeDir, { recursive: true, force: true });
  });

  describe('GET /api/lenses', () => {
    it('returns built-in lenses', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/lenses' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lenses.length).toBeGreaterThan(0);
      expect(body.lenses.some((l: any) => l.builtIn)).toBe(true);
    });

    it('filters by type', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/lenses?type=compound' });
      const body = res.json();
      expect(body.lenses.every((l: any) => l.type === 'compound')).toBe(true);
    });

    it('rejects invalid type', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/lenses?type=invalid' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/lenses', () => {
    it('creates a new lens', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lenses',
        payload: { name: 'My Lens', type: 'compound', prompt: 'Group by vibes' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.lens.name).toBe('My Lens');
      expect(body.lens.type).toBe('compound');
      expect(body.lens.builtIn).toBe(false);
    });

    it('rejects missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lenses',
        payload: { name: 'No Prompt' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/lenses/:id', () => {
    it('returns a built-in lens', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/lenses/compound-architectural-layer' });
      expect(res.statusCode).toBe(200);
      expect(res.json().lens.name).toBe('Architectural Layers');
    });

    it('returns 404 for unknown lens', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/lenses/nope' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/lenses/:id', () => {
    it('deletes a user lens', async () => {
      // Create one first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lenses',
        payload: { name: 'Doomed', type: 'layer', prompt: 'Rate by doom' },
      });
      const id = createRes.json().lens.id;

      const delRes = await app.inject({ method: 'DELETE', url: `/api/lenses/${id}` });
      expect(delRes.statusCode).toBe(200);

      // Verify it's gone
      const getRes = await app.inject({ method: 'GET', url: `/api/lenses/${id}` });
      expect(getRes.statusCode).toBe(404);
    });

    it('deletes a built-in lens', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/lenses/compound-architectural-layer' });
      expect(res.statusCode).toBe(200);

      // Verify it's gone from list
      const listRes = await app.inject({ method: 'GET', url: '/api/lenses' });
      const lenses = listRes.json().lenses;
      expect(lenses.find((l: any) => l.id === 'compound-architectural-layer')).toBeUndefined();
    });

    it('returns 404 for unknown lens', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/lenses/nope' });
      expect(res.statusCode).toBe(404);
    });
  });
});
