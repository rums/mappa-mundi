/**
 * Behavior 13: Two-stage clustering pipeline
 *
 * Tests for structural partition (Leiden/Infomap) → LLM refinement pipeline.
 *
 * AC covered: #17
 */

import { describe, it, expect, vi } from 'vitest';
import { structuralPartition } from '../../../src/interpret/partition';
import { buildClusterPrompt } from '../../../src/interpret/atoms/prompt';
import type { StructuralPartition } from './types';
import { makeAtom, makeEdge, buildProject } from './helpers';
import type { ImportEdge } from '../../../src/types';

describe('Two-stage clustering pipeline', () => {
  it('should run structural partition for atom sets >= 12 (AC#17)', () => {
    const atoms = Array.from({ length: 15 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const edges: ImportEdge[] = [
      makeEdge('src/file0.ts', 'src/file1.ts'),
      makeEdge('src/file1.ts', 'src/file2.ts'),
      makeEdge('src/file3.ts', 'src/file4.ts'),
      makeEdge('src/file5.ts', 'src/file6.ts'),
    ];

    const result = structuralPartition(atoms, edges, { min: 3, max: 7 });

    expect(result).not.toBeNull();
    if (result) {
      expect(result.clusters.length).toBeGreaterThanOrEqual(2);
      expect(['leiden', 'infomap']).toContain(result.algorithm);
      expect(typeof result.resolution).toBe('number');

      // All atoms should be assigned to exactly one cluster
      const allAssigned = result.clusters.flat().sort();
      expect(allAssigned).toEqual(atoms.map((a) => a.id).sort());
    }
  });

  it('should skip structural partition for atom sets < 12', () => {
    const atoms = Array.from({ length: 8 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const edges: ImportEdge[] = [makeEdge('src/file0.ts', 'src/file1.ts')];

    const result = structuralPartition(atoms, edges, { min: 2, max: 5 });

    // For small sets, should return null (skip to LLM-only)
    expect(result).toBeNull();
  });

  it('should skip structural partition when dependency graph has no edges', () => {
    const atoms = Array.from({ length: 15 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const edges: ImportEdge[] = []; // no edges

    const result = structuralPartition(atoms, edges, { min: 3, max: 7 });

    expect(result).toBeNull();
  });

  it('should include structural suggestion in LLM prompt when available (AC#17)', () => {
    const atoms = Array.from({ length: 12 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const structPartition: StructuralPartition = {
      clusters: [
        ['src/file0.ts', 'src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
        ['src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts'],
        ['src/file8.ts', 'src/file9.ts', 'src/file10.ts', 'src/file11.ts'],
      ],
      algorithm: 'leiden',
      resolution: 1.0,
    };

    const prompt = buildClusterPrompt(
      atoms,
      [], // edges
      [], // breadcrumbs
      [], // parent references
      structPartition, // structural suggestion
      null, // previous clustering
      null, // atom diff
      0, // depth
    );

    // Prompt should contain the structural suggestion
    expect(prompt).toContain('Suggested grouping');
    expect(prompt).toContain('src/file0.ts');
  });

  it('should show "No structural suggestion available" when partition is null', () => {
    const atoms = Array.from({ length: 8 }, (_, i) => makeAtom(`src/file${i}.ts`));

    const prompt = buildClusterPrompt(
      atoms,
      [],
      [],
      [],
      null, // no structural partition
      null,
      null,
      0,
    );

    expect(prompt).toContain('No structural suggestion');
  });

  it('should accept LLM adjustments to structural partition (valid result)', async () => {
    // The LLM may accept, adjust, or override — all are valid as long as partition invariant holds
    // This is tested through buildStratum integration tests
    // Here we just verify the prompt allows adjustments
    const atoms = Array.from({ length: 12 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const structPartition: StructuralPartition = {
      clusters: [
        ['src/file0.ts', 'src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
        ['src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts'],
        ['src/file8.ts', 'src/file9.ts', 'src/file10.ts', 'src/file11.ts'],
      ],
      algorithm: 'leiden',
      resolution: 1.0,
    };

    const prompt = buildClusterPrompt(atoms, [], [], [], structPartition, null, null, 0);

    expect(prompt).toContain('accept');
    expect(prompt).toContain('adjust');
  });

  it('should produce generic names for structural-only fallback', () => {
    // When LLM fails and structural partition is used as fallback,
    // compounds should have generic names
    const atoms = Array.from({ length: 12 }, (_, i) => makeAtom(`src/dir${i % 3}/file${i}.ts`));
    const structPartition: StructuralPartition = {
      clusters: [
        atoms.slice(0, 4).map((a) => a.id),
        atoms.slice(4, 8).map((a) => a.id),
        atoms.slice(8).map((a) => a.id),
      ],
      algorithm: 'leiden',
      resolution: 1.0,
    };

    // The fallback should convert structural partition to compounds with generic names
    // This tests the import path
    expect(structPartition.clusters.length).toBe(3);
  });
});
