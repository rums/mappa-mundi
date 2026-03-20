import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { AuthorCountLayer } from '../../src/layers/author-count-layer';
import type { LayerScore } from '../../src/layers/types';

function makeGraph(modules: { id: string; filePath: string }[]): DependencyGraph {
  return {
    root: '/project',
    nodes: modules.map((m) => ({
      id: m.id,
      filePath: m.filePath,
      exports: [],
      symbols: [],
    })),
    edges: [],
  };
}

function makeDirTree(files: string[]): DirectoryNode {
  return {
    name: 'root',
    path: '.',
    files,
    children: [],
    isBoundary: false,
    metrics: {
      fileCount: files.length,
      totalLoc: 100,
      fileCountByExtension: {},
      exportedSymbolCount: 0,
      subtreeFileCount: files.length,
      subtreeLoc: 100,
      subtreeExportedSymbolCount: 0,
      inboundEdges: 0,
      outboundEdges: 0,
    },
  };
}

describe('AuthorCountLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new AuthorCountLayer();
    expect(layer.id).toBe('git-author-count');
    expect(layer.name).toBe('Author Count');
    expect(layer.description).toBeDefined();
  });

  it('should normalize scores relative to max author count', () => {
    const layer = new AuthorCountLayer();
    const graph = makeGraph([
      { id: 'shared.ts', filePath: '/project/shared.ts' },
      { id: 'solo.ts', filePath: '/project/solo.ts' },
    ]);
    const dirTree = makeDirTree(['shared.ts', 'solo.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      authorCount: { 'shared.ts': 10, 'solo.ts': 1 },
    });

    expect(result.moduleScores.get('shared.ts')!.value).toBe(1.0);
    expect(result.moduleScores.get('shared.ts')!.raw).toBe(10);
    expect(result.moduleScores.get('solo.ts')!.value).toBeCloseTo(0.1);
    expect(result.moduleScores.get('solo.ts')!.raw).toBe(1);
  });

  it('should label single-author files as bus factor risk', () => {
    const layer = new AuthorCountLayer();
    const graph = makeGraph([{ id: 'solo.ts', filePath: '/project/solo.ts' }]);
    const dirTree = makeDirTree(['solo.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      authorCount: { 'solo.ts': 1 },
    });

    expect(result.moduleScores.get('solo.ts')!.label).toContain('bus factor');
  });

  it('should handle files with no git history', () => {
    const layer = new AuthorCountLayer();
    const graph = makeGraph([{ id: 'new.ts', filePath: '/project/new.ts' }]);
    const dirTree = makeDirTree(['new.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      authorCount: {},
    });

    const score = result.moduleScores.get('new.ts')!;
    expect(score.raw).toBe(0);
    expect(score.label).toBe('No git history');
  });

  it('should assign severity based on author count', () => {
    const layer = new AuthorCountLayer();
    const graph = makeGraph([
      { id: 'solo.ts', filePath: '/project/solo.ts' },
      { id: 'team.ts', filePath: '/project/team.ts' },
      { id: 'crowd.ts', filePath: '/project/crowd.ts' },
    ]);
    const dirTree = makeDirTree(['solo.ts', 'team.ts', 'crowd.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      authorCount: { 'solo.ts': 1, 'team.ts': 3, 'crowd.ts': 8 },
    });

    expect(result.moduleScores.get('solo.ts')!.severity).toBe('info');
    expect(result.moduleScores.get('team.ts')!.severity).toBe('warning');
    expect(result.moduleScores.get('crowd.ts')!.severity).toBe('critical');
  });

  describe('aggregateToRegions', () => {
    it('should use max author count for region score', () => {
      const layer = new AuthorCountLayer();
      const moduleScores = new Map<string, LayerScore>([
        ['a.ts', { value: 0.2, raw: 2, label: '2 authors', severity: 'warning' }],
        ['b.ts', { value: 1.0, raw: 10, label: '10 authors', severity: 'critical' }],
      ]);

      const regions: Region[] = [
        { id: 'core', name: 'Core', moduleCount: 2, loc: 200 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.get('core')!.raw).toBe(10);
    });
  });
});
