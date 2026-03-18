import { describe, it, expect } from 'vitest';
import { detectBoundary, computeEdgeCounts } from '../src/boundary-detector';
import type { DependencyGraph, ImportEdge } from '../src/types';

// ─── Boundary Detection Logic ──────────────────────────────────────────────

describe('Boundary Detector: detectBoundary', () => {
  it('should return true when cross-boundary proportion meets threshold', () => {
    // 8 cross-boundary edges out of 10 total = 0.8 >= 0.7
    const result = detectBoundary(8, 2, 0.7);
    expect(result).toBe(true);
  });

  it('should return false when cross-boundary proportion is below threshold', () => {
    // 3 cross-boundary edges out of 10 total = 0.3 < 0.7
    const result = detectBoundary(3, 7, 0.7);
    expect(result).toBe(false);
  });

  it('should return false when total edges is zero', () => {
    const result = detectBoundary(0, 0, 0.7);
    expect(result).toBe(false);
  });

  it('should return true at exact threshold boundary', () => {
    // 7 cross-boundary edges out of 10 total = 0.7 >= 0.7
    const result = detectBoundary(7, 3, 0.7);
    expect(result).toBe(true);
  });

  it('should respect custom threshold values', () => {
    // 5 cross-boundary out of 10 = 0.5
    // With threshold 0.4 → boundary
    expect(detectBoundary(5, 5, 0.4)).toBe(true);
    // With threshold 0.6 → not boundary (0.5 < 0.6)
    expect(detectBoundary(5, 5, 0.6)).toBe(false);
  });
});

// ─── Edge Count Computation ────────────────────────────────────────────────

describe('Boundary Detector: computeEdgeCounts', () => {
  it('should count inbound and outbound edges for a directory', () => {
    const edges: ImportEdge[] = [
      // auth/a.ts → api/b.ts (outbound for auth)
      { source: 'src/auth/a.ts', target: 'src/api/b.ts', imports: [{ name: 'b', kind: 'named' }] },
      // api/b.ts → auth/a.ts (inbound for auth)
      { source: 'src/api/b.ts', target: 'src/auth/a.ts', imports: [{ name: 'a', kind: 'named' }] },
    ];

    const counts = computeEdgeCounts('src/auth', edges);
    expect(counts.inbound).toBe(1);
    expect(counts.outbound).toBe(1);
    expect(counts.internal).toBe(0);
  });

  it('should count edges within directory as internal', () => {
    const edges: ImportEdge[] = [
      { source: 'src/auth/user.ts', target: 'src/auth/helper.ts', imports: [{ name: 'h', kind: 'named' }] },
    ];

    const counts = computeEdgeCounts('src/auth', edges);
    expect(counts.inbound).toBe(0);
    expect(counts.outbound).toBe(0);
    expect(counts.internal).toBe(1);
  });

  it('should count edges in subdirectories as internal to parent', () => {
    const edges: ImportEdge[] = [
      // auth/sub/a.ts → auth/sub/b.ts — internal to auth
      { source: 'src/auth/sub/a.ts', target: 'src/auth/sub/b.ts', imports: [{ name: 'b', kind: 'named' }] },
      // auth/sub/a.ts → auth/c.ts — still internal to auth
      { source: 'src/auth/sub/a.ts', target: 'src/auth/c.ts', imports: [{ name: 'c', kind: 'named' }] },
    ];

    const counts = computeEdgeCounts('src/auth', edges);
    expect(counts.inbound).toBe(0);
    expect(counts.outbound).toBe(0);
    expect(counts.internal).toBe(2);
  });

  it('should handle empty edge list', () => {
    const counts = computeEdgeCounts('src/auth', []);
    expect(counts.inbound).toBe(0);
    expect(counts.outbound).toBe(0);
    expect(counts.internal).toBe(0);
  });

  it('should ignore edges that are completely outside the directory', () => {
    const edges: ImportEdge[] = [
      // api → db — neither is in auth
      { source: 'src/api/x.ts', target: 'src/db/y.ts', imports: [{ name: 'y', kind: 'named' }] },
    ];

    const counts = computeEdgeCounts('src/auth', edges);
    expect(counts.inbound).toBe(0);
    expect(counts.outbound).toBe(0);
    expect(counts.internal).toBe(0);
  });
});
