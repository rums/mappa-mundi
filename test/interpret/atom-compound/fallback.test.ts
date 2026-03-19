/**
 * Behavior 7: Fallback
 *
 * Tests for tiered fallback strategy when LLM fails.
 *
 * AC covered: #12
 */

import { describe, it, expect, vi } from 'vitest';
import { fallbackStratum } from '../../../src/interpret/atoms/fallback';
import { buildStratum } from '../../../src/interpret/stratum';
import type { Compound, StructuralPartition } from './types';
import {
  buildProject,
  makeAtom,
  makeDirNode,
  createFailingLLM,
  createMockStratumCache,
  DEFAULT_CONFIG,
} from './helpers';
import type { ImportEdge } from '../../../src/types';

describe('Fallback strategy', () => {
  it('should use structural partition as primary fallback when available', () => {
    const atoms = Array.from({ length: 12 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const edges: ImportEdge[] = [];
    const structuralPartition: StructuralPartition = {
      clusters: [
        ['src/file0.ts', 'src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
        ['src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts'],
        ['src/file8.ts', 'src/file9.ts', 'src/file10.ts', 'src/file11.ts'],
      ],
      algorithm: 'leiden',
      resolution: 1.0,
    };
    const dirTree = makeDirNode('src', 'src', atoms.map((a) => a.id));

    const compounds = fallbackStratum(atoms, edges, structuralPartition, dirTree);

    expect(compounds.length).toBe(3);
    const allAtomIds = compounds.flatMap((c) => c.atomIds).sort();
    expect(allAtomIds).toEqual(atoms.map((a) => a.id).sort());
  });

  it('should fall back to directory grouping when no structural partition', () => {
    const atoms = [
      makeAtom('src/auth/login.ts'),
      makeAtom('src/auth/session.ts'),
      makeAtom('src/api/handler.ts'),
      makeAtom('src/api/router.ts'),
      makeAtom('src/db/connection.ts'),
      makeAtom('src/db/models.ts'),
    ];
    const edges: ImportEdge[] = [];
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts', 'src/auth/session.ts']),
      makeDirNode('api', 'src/api', ['src/api/handler.ts', 'src/api/router.ts']),
      makeDirNode('db', 'src/db', ['src/db/connection.ts', 'src/db/models.ts']),
    ]);

    const compounds = fallbackStratum(atoms, edges, null, dirTree);

    expect(compounds.length).toBeGreaterThanOrEqual(2);
    const allAtomIds = compounds.flatMap((c) => c.atomIds).sort();
    expect(allAtomIds).toEqual(atoms.map((a) => a.id).sort());
  });

  it('should use flat split when all atoms are in same directory (AC#12 flat split)', () => {
    // 13 atoms, minCompoundSize=6, same dir → ceil(13/6)=3 groups → [5, 4, 4]
    const atoms = Array.from({ length: 13 }, (_, i) => makeAtom(`src/utils/file${i}.ts`));
    const edges: ImportEdge[] = [];
    const dirTree = makeDirNode('utils', 'src/utils', atoms.map((a) => a.id));

    const compounds = fallbackStratum(atoms, edges, null, dirTree);

    expect(compounds.length).toBe(3); // ceil(13/6) = 3
    const sizes = compounds.map((c) => c.atomIds.length).sort((a, b) => b - a);
    expect(sizes).toEqual([5, 4, 4]);
  });

  it('should produce valid partition invariant from fallback (AC#12)', () => {
    const atoms = Array.from({ length: 20 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const edges: ImportEdge[] = [];
    const dirTree = makeDirNode('src', 'src', atoms.map((a) => a.id));

    const compounds = fallbackStratum(atoms, edges, null, dirTree);

    // Partition invariant: every atom in exactly one compound
    const allAtomIds = compounds.flatMap((c) => c.atomIds);
    const unique = new Set(allAtomIds);
    expect(allAtomIds.length).toBe(unique.size);
    expect(unique.size).toBe(atoms.length);
  });

  it('should set quality.source correctly for each fallback tier', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const llm = createFailingLLM();
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // quality.source should reflect which fallback was used
    expect(['structural', 'fallback-directory', 'fallback-flat']).toContain(stratum.quality.source);
  });

  it('should cache fallback results', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const llm = createFailingLLM();
    const cache = createMockStratumCache();

    await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(cache.set).toHaveBeenCalled();
  });

  it('should produce strata indistinguishable in structure from LLM results', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const llm = createFailingLLM();
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Same structure as LLM-produced stratum
    expect(stratum).toHaveProperty('depth');
    expect(stratum).toHaveProperty('parentCompoundId');
    expect(stratum).toHaveProperty('compounds');
    expect(stratum).toHaveProperty('relationships');
    expect(stratum).toHaveProperty('breadcrumbs');
    expect(stratum).toHaveProperty('sourceHash');
    expect(stratum).toHaveProperty('quality');
    expect(stratum).toHaveProperty('generatedAt');

    for (const compound of stratum.compounds) {
      expect(compound).toHaveProperty('id');
      expect(compound).toHaveProperty('name');
      expect(compound).toHaveProperty('summary');
      expect(compound).toHaveProperty('atomIds');
      expect(compound).toHaveProperty('references');
      expect(compound).toHaveProperty('zoomable');
    }
  });
});
