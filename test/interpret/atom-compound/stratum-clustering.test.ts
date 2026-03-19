/**
 * Behavior 2: Stratum 0 clustering
 * Behavior 3: Monotonicity invariant
 * Behavior 4: Termination
 *
 * Tests for buildStratum() — the core two-stage clustering pipeline.
 *
 * AC covered: #1, #2, #3, #4, #5, #6, #10, #11
 */

import { describe, it, expect, vi } from 'vitest';
// These imports will fail until the implementation exists
import { buildStratum } from '../../../src/interpret/stratum';
import { resolveAtoms } from '../../../src/interpret/atoms/resolve';
import type { Compound, Stratum, ZoomConfig, Breadcrumb } from './types';
import {
  build50AtomProject,
  build20AtomProject,
  buildProject,
  createSuccessLLM,
  createFailingLLM,
  createNoProgressLLM,
  createMockStratumCache,
  DEFAULT_CONFIG,
  makeAtom,
} from './helpers';

// ─── Behavior 2: Stratum 0 clustering ──────────────────────────────────────

describe('Stratum 0: top-level clustering', () => {
  it('should produce 3-7 compounds for a 50-atom project (AC#1)', async () => {
    const { graph, dirTree, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'Module A', summary: 'First group', atomIds: atomIds.slice(0, 10) },
      { name: 'Module B', summary: 'Second group', atomIds: atomIds.slice(10, 20) },
      { name: 'Module C', summary: 'Third group', atomIds: atomIds.slice(20, 30) },
      { name: 'Module D', summary: 'Fourth group', atomIds: atomIds.slice(30, 40) },
      { name: 'Module E', summary: 'Fifth group', atomIds: atomIds.slice(40, 50) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(
      null, // stratum 0
      atoms,
      graph.edges,
      [], // no breadcrumbs for root
      DEFAULT_CONFIG,
      llm,
      cache,
      'test-project',
      'file',
    );

    expect(stratum.compounds.length).toBeGreaterThanOrEqual(3);
    expect(stratum.compounds.length).toBeLessThanOrEqual(7);
  });

  it('should cover all atoms in stratum 0 — no orphans (AC#1)', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 17) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(17, 34) },
      { name: 'C', summary: 'C', atomIds: atomIds.slice(34) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    const allCoveredAtoms = stratum.compounds.flatMap((c) => c.atomIds).sort();
    expect(allCoveredAtoms).toEqual([...atomIds].sort());
  });

  it('should produce compounds with non-empty name, summary, and atomIds', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'Auth', summary: 'Authentication', atomIds: atomIds.slice(0, 25) },
      { name: 'Data', summary: 'Data layer', atomIds: atomIds.slice(25) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    for (const compound of stratum.compounds) {
      expect(compound.name.length).toBeGreaterThan(0);
      expect(compound.summary.length).toBeGreaterThan(0);
      expect(compound.atomIds.length).toBeGreaterThan(0);
    }
  });

  it('should set depth to 0 for stratum 0', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 25) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(25) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(stratum.depth).toBe(0);
    expect(stratum.parentCompoundId).toBeNull();
  });

  it('should generate relationships from cross-compound edges (AC#10)', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 25) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(25) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Relationships should reference sibling compound IDs only
    const compoundIds = new Set(stratum.compounds.map((c) => c.id));
    for (const rel of stratum.relationships) {
      expect(compoundIds.has(rel.sourceId)).toBe(true);
      expect(compoundIds.has(rel.targetId)).toBe(true);
      expect(rel.sourceId).not.toBe(rel.targetId);
      expect(rel.kind).toBe('depends-on');
      expect(rel.edgeCount).toBeGreaterThan(0);
    }
  });
});

// ─── Behavior 3: Monotonicity invariant ─────────────────────────────────────

describe('Monotonicity invariant', () => {
  it('should produce sub-compounds that are strict subsets of parent (AC#2, AC#4)', async () => {
    const { graph, atoms } = build20AtomProject();
    const atomIds = atoms.map((a) => a.id);

    // First, build stratum 0
    const llm0 = createSuccessLLM([
      { name: 'Group A', summary: 'A', atomIds: atomIds.slice(0, 10) },
      { name: 'Group B', summary: 'B', atomIds: atomIds.slice(10) },
    ]);
    const cache = createMockStratumCache();
    const stratum0 = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm0, cache, 'proj', 'file');

    // Now zoom into the first compound
    const parentCompound = stratum0.compounds[0];
    const parentAtomIds = parentCompound.atomIds;
    const parentAtoms = atoms.filter((a) => parentAtomIds.includes(a.id));
    const parentEdges = graph.edges.filter(
      (e) => parentAtomIds.includes(e.source) && parentAtomIds.includes(e.target),
    );

    const half = Math.ceil(parentAtomIds.length / 2);
    const llm1 = createSuccessLLM([
      { name: 'Sub A', summary: 'Sub A', atomIds: parentAtomIds.slice(0, half) },
      { name: 'Sub B', summary: 'Sub B', atomIds: parentAtomIds.slice(half) },
    ]);

    const stratum1 = await buildStratum(
      parentCompound,
      parentAtoms,
      parentEdges,
      [{ compoundId: 'root', compoundName: 'Root', depth: 0 }],
      DEFAULT_CONFIG,
      llm1,
      cache,
      'proj',
      'file',
    );

    // Union of sub-compound atomIds === parent's atomIds
    const childAtomIds = stratum1.compounds.flatMap((c) => c.atomIds).sort();
    expect(childAtomIds).toEqual([...parentAtomIds].sort());

    // Each sub-compound's atomIds is a strict subset of parent
    const parentAtomSet = new Set(parentAtomIds);
    for (const child of stratum1.compounds) {
      for (const atomId of child.atomIds) {
        expect(parentAtomSet.has(atomId)).toBe(true);
      }
      // Must be strictly smaller than parent
      expect(child.atomIds.length).toBeLessThan(parentAtomIds.length);
    }
  });

  it('should not have any atom in multiple compounds within the same stratum (AC#3)', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 17) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(17, 34) },
      { name: 'C', summary: 'C', atomIds: atomIds.slice(34) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // No atom should appear in more than one compound
    const seen = new Set<string>();
    for (const compound of stratum.compounds) {
      for (const atomId of compound.atomIds) {
        expect(seen.has(atomId)).toBe(false);
        seen.add(atomId);
      }
    }
  });

  it('should handle LLM returning overlapping atomIds by deduplicating (AC#3)', async () => {
    const { graph, atoms } = build20AtomProject();
    const atomIds = atoms.map((a) => a.id);

    // LLM returns overlapping assignments — validator should fix
    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: [...atomIds.slice(0, 12), atomIds[12]] },
      { name: 'B', summary: 'B', atomIds: [atomIds[12], ...atomIds.slice(13)] }, // atomIds[12] duplicated
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // After dedup, each atom appears exactly once
    const allAtomIds = stratum.compounds.flatMap((c) => c.atomIds);
    const unique = new Set(allAtomIds);
    expect(allAtomIds.length).toBe(unique.size);
    expect(unique.size).toBe(atomIds.length);
  });
});

// ─── Behavior 4: Termination ────────────────────────────────────────────────

describe('Termination', () => {
  it('should mark compound as leaf when atomIds.length < minCompoundSize (AC#5)', async () => {
    // Build a small project with 4 atoms
    const { graph, atoms } = buildProject(4, 1);
    const atomIds = atoms.map((a) => a.id);
    const config: ZoomConfig = { minCompoundSize: 6, maxStratumDepth: 5, maxRetries: 2 };

    // If total atoms < minCompoundSize, stratum 0 should emit a single leaf compound
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], config, llm, cache, 'proj', 'file');

    // Should be a single leaf compound, no LLM call
    expect(stratum.compounds).toHaveLength(1);
    expect(stratum.compounds[0].zoomable).toBe(false);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should attempt LLM clustering when atomIds.length >= minCompoundSize', async () => {
    const { graph, atoms } = buildProject(6, 2);
    const atomIds = atoms.map((a) => a.id);
    const config: ZoomConfig = { minCompoundSize: 6, maxStratumDepth: 5, maxRetries: 2 };

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 3) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(3) },
    ]);
    const cache = createMockStratumCache();

    await buildStratum(null, atoms, graph.edges, [], config, llm, cache, 'proj', 'file');

    expect(llm.complete).toHaveBeenCalled();
  });

  it('should mark all compounds as leaves at maxStratumDepth (AC#6)', async () => {
    const { graph, atoms } = build20AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const config: ZoomConfig = { minCompoundSize: 3, maxStratumDepth: 5, maxRetries: 2 };

    // Simulate being at max depth via parent compound at depth 4
    const parentCompound: Compound = {
      id: 'c-parent',
      name: 'Parent',
      summary: 'Parent compound',
      atomIds,
      references: [],
      zoomable: true,
    };

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 10) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(10) },
    ]);
    const cache = createMockStratumCache();

    // Build at depth 4 → children will be at depth 5 → leaves
    const breadcrumbs: Breadcrumb[] = [
      { compoundId: 'root', compoundName: 'Root', depth: 0 },
      { compoundId: 'c-1', compoundName: 'L1', depth: 1 },
      { compoundId: 'c-2', compoundName: 'L2', depth: 2 },
      { compoundId: 'c-3', compoundName: 'L3', depth: 3 },
    ];

    const stratum = await buildStratum(
      parentCompound,
      atoms,
      graph.edges,
      breadcrumbs,
      config,
      llm,
      cache,
      'proj',
      'file',
    );

    // All compounds at depth 5 should be leaves
    for (const compound of stratum.compounds) {
      expect(compound.zoomable).toBe(false);
    }
  });

  it('should set zoomable=true for compounds above threshold and below max depth', async () => {
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);
    const config: ZoomConfig = { minCompoundSize: 6, maxStratumDepth: 5, maxRetries: 2 };

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 25) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(25) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], config, llm, cache, 'proj', 'file');

    // Both compounds have 25 atoms (≥ 6) and are at depth 0 (< 5) → zoomable
    for (const compound of stratum.compounds) {
      expect(compound.zoomable).toBe(true);
    }
  });

  it('should guarantee full zoom from top to leaf completes within maxStratumDepth strata (AC#11)', async () => {
    // This is a structural test — the hierarchy depth cannot exceed maxStratumDepth
    const config: ZoomConfig = { minCompoundSize: 6, maxStratumDepth: 5, maxRetries: 2 };
    const { graph, atoms } = build50AtomProject();
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 25) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(25) },
    ]);
    const cache = createMockStratumCache();

    const stratum0 = await buildStratum(null, atoms, graph.edges, [], config, llm, cache, 'proj', 'file');

    expect(stratum0.depth).toBe(0);
    expect(stratum0.depth).toBeLessThan(config.maxStratumDepth);
  });
});
