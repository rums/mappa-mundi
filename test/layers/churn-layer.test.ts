import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { ChurnLayer } from '../../src/layers/churn-layer';
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

describe('ChurnLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new ChurnLayer();
    expect(layer.id).toBe('git-churn');
    expect(layer.name).toBe('Code Churn');
    expect(layer.description).toBeDefined();
  });

  it('should normalize scores relative to max churn', () => {
    const layer = new ChurnLayer();
    const graph = makeGraph([
      { id: 'volatile.ts', filePath: '/project/volatile.ts' },
      { id: 'stable.ts', filePath: '/project/stable.ts' },
    ]);
    const dirTree = makeDirTree(['volatile.ts', 'stable.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      churn: { 'volatile.ts': 5000, 'stable.ts': 100 },
    });

    expect(result.moduleScores.get('volatile.ts')!.value).toBe(1.0);
    expect(result.moduleScores.get('volatile.ts')!.raw).toBe(5000);
    expect(result.moduleScores.get('stable.ts')!.value).toBeCloseTo(0.02);
    expect(result.moduleScores.get('stable.ts')!.raw).toBe(100);
  });

  it('should handle files with no churn', () => {
    const layer = new ChurnLayer();
    const graph = makeGraph([{ id: 'new.ts', filePath: '/project/new.ts' }]);
    const dirTree = makeDirTree(['new.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      churn: {},
    });

    const score = result.moduleScores.get('new.ts')!;
    expect(score.raw).toBe(0);
    expect(score.label).toBe('No churn');
  });

  it('should assign severity based on normalized value', () => {
    const layer = new ChurnLayer();
    const graph = makeGraph([
      { id: 'low.ts', filePath: '/project/low.ts' },
      { id: 'mid.ts', filePath: '/project/mid.ts' },
      { id: 'high.ts', filePath: '/project/high.ts' },
    ]);
    const dirTree = makeDirTree(['low.ts', 'mid.ts', 'high.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      churn: { 'low.ts': 100, 'mid.ts': 500, 'high.ts': 1000 },
    });

    expect(result.moduleScores.get('low.ts')!.severity).toBe('info');
    expect(result.moduleScores.get('mid.ts')!.severity).toBe('warning');
    expect(result.moduleScores.get('high.ts')!.severity).toBe('critical');
  });

  describe('aggregateToRegions', () => {
    it('should use max churn for region score', () => {
      const layer = new ChurnLayer();
      const moduleScores = new Map<string, LayerScore>([
        ['a.ts', { value: 0.1, raw: 100, label: '100 lines churned', severity: 'info' }],
        ['b.ts', { value: 1.0, raw: 5000, label: '5000 lines churned', severity: 'critical' }],
      ]);

      const regions: Region[] = [
        { id: 'core', name: 'Core', moduleCount: 2, loc: 200 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.get('core')!.raw).toBe(5000);
    });

    it('should skip empty regions', () => {
      const layer = new ChurnLayer();
      const moduleScores = new Map<string, LayerScore>();
      const regions: Region[] = [
        { id: 'empty', name: 'Empty', moduleCount: 0, loc: 0 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.has('empty')).toBe(false);
    });
  });
});
