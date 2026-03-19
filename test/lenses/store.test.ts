import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LensStore } from '../../src/lenses/store.js';

describe('LensStore', () => {
  let storeDir: string;
  let store: LensStore;

  beforeEach(() => {
    storeDir = join(tmpdir(), `mappa-lenses-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    store = new LensStore(storeDir);
  });

  afterEach(() => {
    if (existsSync(storeDir)) {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  describe('list()', () => {
    it('returns built-in lenses by default', () => {
      const lenses = store.list();
      expect(lenses.length).toBeGreaterThan(0);
      expect(lenses.some(l => l.type === 'compound')).toBe(true);
      expect(lenses.some(l => l.type === 'layer')).toBe(true);
    });

    it('filters by type', () => {
      const compound = store.list('compound');
      expect(compound.every(l => l.type === 'compound')).toBe(true);

      const layer = store.list('layer');
      expect(layer.every(l => l.type === 'layer')).toBe(true);
    });

    it('includes user-created lenses', () => {
      store.create('My Custom', 'compound', 'Group by color');
      const lenses = store.list();
      expect(lenses.some(l => l.name === 'My Custom')).toBe(true);
    });
  });

  describe('get()', () => {
    it('returns built-in lens by ID', () => {
      const lens = store.get('compound-architectural-layer');
      expect(lens).toBeDefined();
      expect(lens!.name).toBe('Architectural Layers');
      expect(lens!.builtIn).toBe(true);
    });

    it('returns user lens by ID', () => {
      const created = store.create('Test Lens', 'layer', 'Rate by fun');
      const found = store.get(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Test Lens');
      expect(found!.builtIn).toBe(false);
    });

    it('returns undefined for unknown ID', () => {
      expect(store.get('does-not-exist')).toBeUndefined();
    });
  });

  describe('create()', () => {
    it('creates a user lens with generated ID', () => {
      const lens = store.create('My Analysis', 'layer', 'Rate by magic');
      expect(lens.id).toMatch(/^layer-my-analysis/);
      expect(lens.builtIn).toBe(false);
      expect(lens.prompt).toBe('Rate by magic');
      expect(lens.createdAt).toBeTruthy();
    });

    it('avoids ID collisions', () => {
      const a = store.create('Same Name', 'compound', 'prompt A');
      const b = store.create('Same Name', 'compound', 'prompt B');
      expect(a.id).not.toBe(b.id);
    });

    it('persists to disk', () => {
      store.create('Persisted', 'compound', 'test prompt');
      // Create a new store pointing at the same dir
      const store2 = new LensStore(storeDir);
      const found = store2.list().find(l => l.name === 'Persisted');
      expect(found).toBeDefined();
    });
  });

  describe('delete()', () => {
    it('deletes a user lens', () => {
      const lens = store.create('To Delete', 'compound', 'bye');
      expect(store.get(lens.id)).toBeDefined();
      const result = store.delete(lens.id);
      expect(result).toBe(true);
      expect(store.get(lens.id)).toBeUndefined();
    });

    it('deletes a built-in lens via marker', () => {
      expect(store.get('compound-architectural-layer')).toBeDefined();
      store.delete('compound-architectural-layer');
      expect(store.get('compound-architectural-layer')).toBeUndefined();
      // Also gone from list
      expect(store.list().find(l => l.id === 'compound-architectural-layer')).toBeUndefined();
    });

    it('returns false for unknown lens', () => {
      expect(store.delete('nope')).toBe(false);
    });
  });
});
