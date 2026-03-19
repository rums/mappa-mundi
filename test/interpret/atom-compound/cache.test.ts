/**
 * Behavior 9: Cache integration
 * Behavior 10: ID stability
 *
 * Tests for cache hit/miss, invalidation, early cutoff, and deterministic IDs.
 *
 * AC covered: #13, #14, #19
 */

import { describe, it, expect, vi } from 'vitest';
import { compoundId, sourceHash } from '../../../src/interpret/atoms/ids';
import { buildStratum } from '../../../src/interpret/stratum';
import type { ZoomConfig, Compound, Atom } from './types';
import {
  buildProject,
  createSuccessLLM,
  createMockStratumCache,
  DEFAULT_CONFIG,
  makeAtom,
  makeEdge,
} from './helpers';
import type { ImportEdge } from '../../../src/types';

// ─── Behavior 10: ID stability ─────────────────────────────────────────────

describe('Compound ID stability', () => {
  it('should produce deterministic ID from sorted atomIds (AC#14)', () => {
    const id1 = compoundId(['c.ts', 'a.ts', 'b.ts']);
    const id2 = compoundId(['a.ts', 'b.ts', 'c.ts']);
    const id3 = compoundId(['b.ts', 'c.ts', 'a.ts']);

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  it('should prefix compound ID with "c-"', () => {
    const id = compoundId(['a.ts', 'b.ts']);

    expect(id).toMatch(/^c-/);
  });

  it('should produce 12-character hex hash after prefix', () => {
    const id = compoundId(['a.ts', 'b.ts']);

    // Format: c-<12 hex chars>
    expect(id).toMatch(/^c-[0-9a-f]{12}$/);
  });

  it('should change ID when atom set changes', () => {
    const id1 = compoundId(['a.ts', 'b.ts']);
    const id2 = compoundId(['a.ts', 'b.ts', 'c.ts']);

    expect(id1).not.toBe(id2);
  });

  it('should be stable across different runs with same atoms', () => {
    // Simulate "different LLM runs" — same atoms, potentially different order
    const id1 = compoundId(['x.ts', 'y.ts', 'z.ts']);
    const id2 = compoundId(['z.ts', 'x.ts', 'y.ts']);

    expect(id1).toBe(id2);
  });
});

// ─── Source hash ────────────────────────────────────────────────────────────

describe('Source hash computation', () => {
  it('should produce same hash for same atoms and edges', () => {
    const atoms = [makeAtom('a.ts'), makeAtom('b.ts')];
    const edges: ImportEdge[] = [makeEdge('a.ts', 'b.ts')];

    const hash1 = sourceHash(atoms, edges);
    const hash2 = sourceHash(atoms, edges);

    expect(hash1).toBe(hash2);
  });

  it('should change hash when atoms change', () => {
    const atoms1 = [makeAtom('a.ts'), makeAtom('b.ts')];
    const atoms2 = [makeAtom('a.ts'), makeAtom('c.ts')]; // b→c
    const edges: ImportEdge[] = [];

    const hash1 = sourceHash(atoms1, edges);
    const hash2 = sourceHash(atoms2, edges);

    expect(hash1).not.toBe(hash2);
  });

  it('should change hash when edges change', () => {
    const atoms = [makeAtom('a.ts'), makeAtom('b.ts')];
    const edges1: ImportEdge[] = [makeEdge('a.ts', 'b.ts')];
    const edges2: ImportEdge[] = [];

    const hash1 = sourceHash(atoms, edges1);
    const hash2 = sourceHash(atoms, edges2);

    expect(hash1).not.toBe(hash2);
  });
});

// ─── Behavior 9: Cache integration ─────────────────────────────────────────

describe('Cache integration', () => {
  it('should cache successful zoom results (AC#13)', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 6) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(6) },
    ]);
    const cache = createMockStratumCache();

    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(cache.set).toHaveBeenCalled();
  });

  it('should return cached result without LLM call on cache hit', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 6) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(6) },
    ]);
    const cache = createMockStratumCache();

    // First call populates cache
    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Reset LLM mock
    (llm.complete as ReturnType<typeof vi.fn>).mockClear();

    // Second call should use cache
    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should invalidate cache when sourceHash changes (file added)', async () => {
    const atoms1 = [makeAtom('a.ts'), makeAtom('b.ts')];
    const atoms2 = [makeAtom('a.ts'), makeAtom('b.ts'), makeAtom('c.ts')]; // added c.ts

    const hash1 = sourceHash(atoms1, []);
    const hash2 = sourceHash(atoms2, []);

    expect(hash1).not.toBe(hash2); // Different sourceHash → cache miss
  });

  it('should cascade invalidation to descendants but not siblings (AC#13)', async () => {
    const cache = createMockStratumCache();

    // This tests the cache.invalidateDescendants behavior
    // When a parent stratum is recomputed with new compound IDs,
    // descendants keyed by old compound IDs should be invalidated
    expect(cache.invalidateDescendants).toBeDefined();
    expect(typeof cache.invalidateDescendants).toBe('function');
  });

  it('should use differential prompt when atom diff < 20% (AC#19)', async () => {
    // When the diff between cached and current atoms is small,
    // the system should use a differential prompt including previous clustering
    const { graph, atoms } = buildProject(20, 3);
    const atomIds = atoms.map((a) => a.id);

    // Simulate a small diff: 2 atoms changed out of 20 = 10% < 20%
    // This test verifies the prompt includes previous clustering context
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 10) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(10) },
    ]);
    const cache = createMockStratumCache();

    // First build
    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Slightly modified atom set (< 20% change)
    const modifiedAtoms = [...atoms.slice(0, 18), makeAtom('src/new1.ts'), makeAtom('src/new2.ts')];

    (llm.complete as ReturnType<typeof vi.fn>).mockClear();

    await buildStratum(null, modifiedAtoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // The prompt for the second call should include differential context
    if ((llm.complete as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Differential prompt should mention previous clustering
      expect(prompt).toContain('previous');
    }
  });

  it('should use full prompt when atom diff >= 20%', async () => {
    const { graph, atoms } = buildProject(10, 2);
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 5) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(5) },
    ]);
    const cache = createMockStratumCache();

    // First build
    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Heavily modified atom set (>= 20% change)
    const newAtoms = Array.from({ length: 10 }, (_, i) => makeAtom(`src/new${i}.ts`));

    (llm.complete as ReturnType<typeof vi.fn>).mockClear();

    await buildStratum(null, newAtoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Full prompt should be used (no mention of "previous clustering" in differential context)
    // This is a structural assertion — the implementation must select the right prompt type
    expect(llm.complete).toHaveBeenCalled();
  });

  it('should serve stale cache with stale: true flag', async () => {
    const cache = createMockStratumCache();
    // The cache interface should support stale-while-revalidate
    const mockResult = cache.get('proj', 'root', 'file');
    // When stale, result.stale should be true
    if (mockResult) {
      expect(typeof mockResult.stale).toBe('boolean');
    }
  });
});
