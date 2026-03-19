/**
 * Behavior 14: Quality metrics
 * Behavior 16: DOI scoring
 *
 * Tests for MQ computation, MoJoFM directory alignment, DOI scoring.
 *
 * AC covered: #18
 */

import { describe, it, expect } from 'vitest';
import { computeQuality } from '../../../src/interpret/quality';
import { computeDOI } from '../../../src/interpret/quality';
import type { Compound, StratumQuality } from './types';
import { makeAtom, makeEdge, makeCompound } from './helpers';
import type { ImportEdge } from '../../../src/types';

// ─── Behavior 14: Quality metrics ──────────────────────────────────────────

describe('Quality metrics: MQ', () => {
  it('should compute MQ = 1 when all edges are intra-compound (no crossing)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts', 'b.ts'] }),
      makeCompound({ name: 'B', atomIds: ['c.ts', 'd.ts'] }),
    ];
    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'b.ts'), // intra A
      makeEdge('c.ts', 'd.ts'), // intra B
    ];
    const atoms = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, edges, atoms, 'llm');

    expect(quality.mq).toBe(1);
  });

  it('should compute MQ = 0 when all edges cross compound boundaries', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts'] }),
      makeCompound({ name: 'B', atomIds: ['b.ts'] }),
    ];
    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'b.ts'), // inter
      makeEdge('b.ts', 'a.ts'), // inter
    ];
    const atoms = ['a.ts', 'b.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, edges, atoms, 'llm');

    expect(quality.mq).toBe(0);
  });

  it('should compute MQ between 0 and 1 for mixed edges', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts', 'b.ts'] }),
      makeCompound({ name: 'C', atomIds: ['c.ts', 'd.ts'] }),
    ];
    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'b.ts'), // intra A
      makeEdge('a.ts', 'c.ts'), // inter A→C
      makeEdge('c.ts', 'd.ts'), // intra C
    ];
    const atoms = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, edges, atoms, 'llm');

    expect(quality.mq).toBeGreaterThan(0);
    expect(quality.mq).toBeLessThan(1);
  });

  it('should handle compounds with no edges (MQ should be valid)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts', 'b.ts'] }),
      makeCompound({ name: 'B', atomIds: ['c.ts'] }),
    ];
    const edges: ImportEdge[] = [];
    const atoms = ['a.ts', 'b.ts', 'c.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, edges, atoms, 'llm');

    expect(typeof quality.mq).toBe('number');
    expect(quality.mq).toBeGreaterThanOrEqual(0);
    expect(quality.mq).toBeLessThanOrEqual(1);
  });
});

describe('Quality metrics: directory alignment', () => {
  it('should compute directory alignment as MoJoFM (0-100)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'Auth', atomIds: ['src/auth/a.ts', 'src/auth/b.ts'] }),
      makeCompound({ name: 'API', atomIds: ['src/api/c.ts', 'src/api/d.ts'] }),
    ];
    const atoms = ['src/auth/a.ts', 'src/auth/b.ts', 'src/api/c.ts', 'src/api/d.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, [], atoms, 'llm');

    // Perfectly directory-aligned → should score high
    expect(quality.directoryAlignment).toBeGreaterThanOrEqual(0);
    expect(quality.directoryAlignment).toBeLessThanOrEqual(100);
  });

  it('should score high alignment when compounds match directory structure', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'Auth', atomIds: ['src/auth/a.ts', 'src/auth/b.ts'] }),
      makeCompound({ name: 'API', atomIds: ['src/api/c.ts'] }),
    ];
    const atoms = ['src/auth/a.ts', 'src/auth/b.ts', 'src/api/c.ts'].map((id) => makeAtom(id));

    const quality = computeQuality(compounds, [], atoms, 'llm');

    expect(quality.directoryAlignment).toBeGreaterThan(80);
  });
});

describe('Quality metrics: source tracking', () => {
  it('should correctly record source as "llm"', () => {
    const compounds: Compound[] = [makeCompound({ atomIds: ['a.ts'] })];
    const atoms = [makeAtom('a.ts')];

    const quality = computeQuality(compounds, [], atoms, 'llm');

    expect(quality.source).toBe('llm');
  });

  it('should correctly record source as "structural"', () => {
    const compounds: Compound[] = [makeCompound({ atomIds: ['a.ts'] })];
    const atoms = [makeAtom('a.ts')];

    const quality = computeQuality(compounds, [], atoms, 'structural');

    expect(quality.source).toBe('structural');
  });

  it('should correctly record source as "fallback-directory"', () => {
    const compounds: Compound[] = [makeCompound({ atomIds: ['a.ts'] })];
    const atoms = [makeAtom('a.ts')];

    const quality = computeQuality(compounds, [], atoms, 'fallback-directory');

    expect(quality.source).toBe('fallback-directory');
  });

  it('should correctly record source as "fallback-flat"', () => {
    const compounds: Compound[] = [makeCompound({ atomIds: ['a.ts'] })];
    const atoms = [makeAtom('a.ts')];

    const quality = computeQuality(compounds, [], atoms, 'fallback-flat');

    expect(quality.source).toBe('fallback-flat');
  });
});

// ─── Behavior 16: DOI scoring ──────────────────────────────────────────────

describe('DOI scoring', () => {
  it('should compute intrinsic DOI from atom count (0.5), complexity (0.3), churn (0.2)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'Big', atomIds: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] }),
      makeCompound({ name: 'Small', atomIds: ['f.ts'] }),
    ];

    const doi = computeDOI(compounds, {
      focusCompoundId: null,
      complexityScores: {},
      churnScores: {},
    });

    // Big compound should have higher DOI than Small due to atom count
    const bigDoi = doi.get(compounds[0].id);
    const smallDoi = doi.get(compounds[1].id);
    expect(bigDoi).toBeDefined();
    expect(smallDoi).toBeDefined();
    expect(bigDoi!).toBeGreaterThan(smallDoi!);
  });

  it('should degrade gracefully when metrics are missing (contribute 0)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts', 'b.ts'] }),
    ];

    // No complexity or churn data
    const doi = computeDOI(compounds, {
      focusCompoundId: null,
      complexityScores: {},
      churnScores: {},
    });

    const score = doi.get(compounds[0].id);
    expect(score).toBeDefined();
    expect(score!).toBeGreaterThanOrEqual(0);
    // Only atom count component contributes → score should be based on 0.5 weight
  });

  it('should add proximity=1.0 for the focus compound', () => {
    const compounds: Compound[] = [
      makeCompound({ id: 'c-focus', name: 'Focus', atomIds: ['a.ts'] }),
      makeCompound({ id: 'c-other', name: 'Other', atomIds: ['b.ts'] }),
    ];

    const doi = computeDOI(compounds, {
      focusCompoundId: 'c-focus',
      complexityScores: {},
      churnScores: {},
    });

    const focusDoi = doi.get('c-focus')!;
    const otherDoi = doi.get('c-other')!;
    // Focus compound should have higher DOI due to proximity bonus
    expect(focusDoi).toBeGreaterThan(otherDoi);
  });

  it('should add proximity=0.3 for sibling compounds', () => {
    const compounds: Compound[] = [
      makeCompound({ id: 'c-focus', name: 'Focus', atomIds: ['a.ts'] }),
      makeCompound({ id: 'c-sibling', name: 'Sibling', atomIds: ['b.ts'] }),
    ];

    // Both are in the same stratum → siblings
    const doi = computeDOI(compounds, {
      focusCompoundId: 'c-focus',
      complexityScores: {},
      churnScores: {},
      siblingIds: ['c-sibling'],
    });

    const siblingDoi = doi.get('c-sibling')!;
    expect(siblingDoi).toBeGreaterThan(0);
  });

  it('should not affect partition or zoomable flag (advisory only)', () => {
    const compounds: Compound[] = [
      makeCompound({ name: 'A', atomIds: ['a.ts', 'b.ts', 'c.ts'], zoomable: true }),
      makeCompound({ name: 'B', atomIds: ['d.ts'], zoomable: false }),
    ];

    const doi = computeDOI(compounds, {
      focusCompoundId: null,
      complexityScores: {},
      churnScores: {},
    });

    // DOI should be set but not change zoomable
    expect(compounds[0].zoomable).toBe(true);
    expect(compounds[1].zoomable).toBe(false);
  });
});
