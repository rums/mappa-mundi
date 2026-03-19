/**
 * Behavior 1: Atom resolution
 *
 * Tests for resolveAtoms() — converting a DependencyGraph into an immutable atom set.
 *
 * AC covered: #1 (partial — atom resolution is the foundation)
 */

import { describe, it, expect } from 'vitest';
// This import will fail until the implementation exists — proving red state
import { resolveAtoms } from '../../../src/interpret/atoms/resolve';
import type { DependencyGraph } from '../../../src/types';
import { makeModule, makeEdge } from './helpers';

describe('Atom Resolution', () => {
  it('should produce one atom per module node in the dependency graph', () => {
    const modules = Array.from({ length: 10 }, (_, i) =>
      makeModule(`src/file${i}.ts`, [
        { name: `fn${i}`, kind: 'function', signature: '(): void', exported: true },
      ]),
    );
    const graph: DependencyGraph = {
      root: '/project',
      nodes: modules,
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms).toHaveLength(10);
  });

  it('should set atom.id to module node id', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [makeModule('src/auth/login.ts')],
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms[0].id).toBe('src/auth/login.ts');
  });

  it('should set atom.filePath from module node', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [makeModule('src/auth/login.ts')],
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms[0].filePath).toBeDefined();
    expect(typeof atoms[0].filePath).toBe('string');
  });

  it('should set atom.label to filename', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [makeModule('src/auth/login.ts')],
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms[0].label).toBe('login.ts');
  });

  it('should include exported symbols in atom metadata', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [
        makeModule('src/auth/login.ts', [
          { name: 'login', kind: 'function', signature: '(): void', exported: true },
          { name: 'logout', kind: 'function', signature: '(): void', exported: true },
          { name: 'helper', kind: 'function', signature: '(): void', exported: false },
        ]),
      ],
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms[0].metadata?.exportedSymbols).toContain('login');
    expect(atoms[0].metadata?.exportedSymbols).toContain('logout');
    expect(atoms[0].metadata?.exportedSymbols).not.toContain('helper');
  });

  it('should produce an immutable atom set (same graph → same atoms)', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [makeModule('src/a.ts'), makeModule('src/b.ts')],
      edges: [],
    };

    const atoms1 = resolveAtoms(graph);
    const atoms2 = resolveAtoms(graph);

    expect(atoms1).toEqual(atoms2);
  });

  it('should handle empty dependency graph', () => {
    const graph: DependencyGraph = {
      root: '/project',
      nodes: [],
      edges: [],
    };

    const atoms = resolveAtoms(graph);

    expect(atoms).toHaveLength(0);
  });
});
