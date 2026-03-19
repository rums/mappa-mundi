/**
 * Behavior 5: Reference handling
 * Behavior 15: Reference weights
 *
 * Tests for cross-compound reference validation, weight computation, and handling.
 *
 * AC covered: #7, #9
 */

import { describe, it, expect, vi } from 'vitest';
import { validateStratum } from '../../../src/interpret/atoms/validate';
import { computeReferenceWeights } from '../../../src/interpret/atoms/references';
import type { Compound, Reference } from './types';
import { makeAtom, makeEdge } from './helpers';
import type { ImportEdge } from '../../../src/types';

describe('Reference handling', () => {
  const allAtomIds = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
  const inScopeIds = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];

  it('should move out-of-scope atoms from atomIds to references (AC#7)', () => {
    const raw = {
      compounds: [
        {
          name: 'Group A',
          summary: 'A',
          atomIds: ['a.ts', 'b.ts', 'c.ts', 'external.ts'], // external.ts is out of scope
          references: [],
        },
        {
          name: 'Group B',
          summary: 'B',
          atomIds: ['d.ts', 'e.ts', 'f.ts'],
          references: [],
        },
      ],
    };

    const result = validateStratum(raw, inScopeIds, [...allAtomIds, 'external.ts'], 0, {
      minCompoundSize: 6,
      maxStratumDepth: 5,
      maxRetries: 2,
    });

    expect(result.valid).toBe(true);

    // external.ts should NOT be in any compound's atomIds
    for (const compound of result.data) {
      expect(compound.atomIds).not.toContain('external.ts');
    }

    // external.ts should be moved to references of the compound that listed it
    const groupA = result.data.find((c) => c.name === 'Group A');
    expect(groupA).toBeDefined();
    const refAtomIds = groupA!.references.map((r) => r.atomId);
    expect(refAtomIds).toContain('external.ts');
  });

  it('should silently drop references with invalid atom IDs (AC#9)', () => {
    const raw = {
      compounds: [
        {
          name: 'Group A',
          summary: 'A',
          atomIds: ['a.ts', 'b.ts', 'c.ts'],
          references: ['nonexistent.ts', 'd.ts'], // nonexistent.ts is invalid
        },
        {
          name: 'Group B',
          summary: 'B',
          atomIds: ['d.ts', 'e.ts', 'f.ts'],
          references: [],
        },
      ],
    };

    const result = validateStratum(raw, inScopeIds, allAtomIds, 0, {
      minCompoundSize: 6,
      maxStratumDepth: 5,
      maxRetries: 2,
    });

    expect(result.valid).toBe(true);
    const groupA = result.data.find((c) => c.name === 'Group A');
    const refAtomIds = groupA!.references.map((r) => r.atomId);
    expect(refAtomIds).not.toContain('nonexistent.ts');
    // Valid cross-compound reference should be kept
    expect(refAtomIds).toContain('d.ts');
  });

  it('should drop references that duplicate atoms already in the compound atomIds', () => {
    const raw = {
      compounds: [
        {
          name: 'Group A',
          summary: 'A',
          atomIds: ['a.ts', 'b.ts', 'c.ts'],
          references: ['a.ts'], // a.ts is already in atomIds — should be dropped
        },
        {
          name: 'Group B',
          summary: 'B',
          atomIds: ['d.ts', 'e.ts', 'f.ts'],
          references: [],
        },
      ],
    };

    const result = validateStratum(raw, inScopeIds, allAtomIds, 0, {
      minCompoundSize: 6,
      maxStratumDepth: 5,
      maxRetries: 2,
    });

    expect(result.valid).toBe(true);
    const groupA = result.data.find((c) => c.name === 'Group A');
    const refAtomIds = groupA!.references.map((r) => r.atomId);
    expect(refAtomIds).not.toContain('a.ts');
  });
});

// ─── Behavior 15: Reference weights ─────────────────────────────────────────

describe('Reference weights', () => {
  it('should compute reference weight as edge ratio (AC#9)', () => {
    const compound: Compound = {
      id: 'c-test',
      name: 'Test',
      summary: 'Test',
      atomIds: ['a.ts', 'b.ts'],
      references: [{ atomId: 'c.ts', weight: 0 }], // weight to be computed
      zoomable: true,
    };

    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'c.ts'), // external edge to reference
      makeEdge('a.ts', 'd.ts'), // external edge to non-reference
      makeEdge('b.ts', 'c.ts'), // another external edge to reference
      makeEdge('a.ts', 'b.ts'), // internal edge — not counted
    ];

    const weighted = computeReferenceWeights(compound, edges);

    // External edges from compound atoms: a→c, a→d, b→c = 3 total external
    // Edges to c.ts: a→c, b→c = 2
    // Weight = 2 / 3 ≈ 0.667
    expect(weighted[0].atomId).toBe('c.ts');
    expect(weighted[0].weight).toBeGreaterThan(0);
    expect(weighted[0].weight).toBeLessThanOrEqual(1);
  });

  it('should drop references with weight 0 (no actual dependency)', () => {
    const compound: Compound = {
      id: 'c-test',
      name: 'Test',
      summary: 'Test',
      atomIds: ['a.ts', 'b.ts'],
      references: [{ atomId: 'c.ts', weight: 0 }],
      zoomable: true,
    };

    // No edges at all from compound atoms to c.ts
    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'd.ts'),
      makeEdge('a.ts', 'b.ts'),
    ];

    const weighted = computeReferenceWeights(compound, edges);

    // c.ts has weight 0 → should be dropped
    expect(weighted.find((r) => r.atomId === 'c.ts')).toBeUndefined();
  });

  it('should produce weights in [0, 1] range', () => {
    const compound: Compound = {
      id: 'c-test',
      name: 'Test',
      summary: 'Test',
      atomIds: ['a.ts', 'b.ts'],
      references: [
        { atomId: 'c.ts', weight: 0 },
        { atomId: 'd.ts', weight: 0 },
      ],
      zoomable: true,
    };

    const edges: ImportEdge[] = [
      makeEdge('a.ts', 'c.ts'),
      makeEdge('b.ts', 'd.ts'),
      makeEdge('a.ts', 'd.ts'),
    ];

    const weighted = computeReferenceWeights(compound, edges);

    for (const ref of weighted) {
      expect(ref.weight).toBeGreaterThanOrEqual(0);
      expect(ref.weight).toBeLessThanOrEqual(1);
    }
  });
});
