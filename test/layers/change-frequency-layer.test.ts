import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { ChangeFrequencyLayer } from '../../src/layers/change-frequency-layer';
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

describe('ChangeFrequencyLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new ChangeFrequencyLayer();
    expect(layer.id).toBe('git-change-frequency');
    expect(layer.name).toBe('Change Frequency');
    expect(layer.description).toBeDefined();
  });

  it('should normalize scores relative to max frequency', () => {
    const layer = new ChangeFrequencyLayer();
    const graph = makeGraph([
      { id: 'hot.ts', filePath: '/project/hot.ts' },
      { id: 'cold.ts', filePath: '/project/cold.ts' },
    ]);
    const dirTree = makeDirTree(['hot.ts', 'cold.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      changeFrequency: { 'hot.ts': 100, 'cold.ts': 10 },
    });

    expect(result.moduleScores.get('hot.ts')!.value).toBe(1.0);
    expect(result.moduleScores.get('hot.ts')!.raw).toBe(100);
    expect(result.moduleScores.get('cold.ts')!.value).toBeCloseTo(0.1);
    expect(result.moduleScores.get('cold.ts')!.raw).toBe(10);
  });

  it('should assign value 0 to files with no commits', () => {
    const layer = new ChangeFrequencyLayer();
    const graph = makeGraph([{ id: 'new.ts', filePath: '/project/new.ts' }]);
    const dirTree = makeDirTree(['new.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      changeFrequency: {},
    });

    const score = result.moduleScores.get('new.ts')!;
    expect(score.raw).toBe(0);
    expect(score.value).toBe(0);
    expect(score.label).toBe('No commits');
  });

  it('should assign severity based on normalized value', () => {
    const layer = new ChangeFrequencyLayer();
    const graph = makeGraph([
      { id: 'low.ts', filePath: '/project/low.ts' },
      { id: 'mid.ts', filePath: '/project/mid.ts' },
      { id: 'high.ts', filePath: '/project/high.ts' },
    ]);
    const dirTree = makeDirTree(['low.ts', 'mid.ts', 'high.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      changeFrequency: { 'low.ts': 10, 'mid.ts': 50, 'high.ts': 100 },
    });

    expect(result.moduleScores.get('low.ts')!.severity).toBe('info');
    expect(result.moduleScores.get('mid.ts')!.severity).toBe('warning');
    expect(result.moduleScores.get('high.ts')!.severity).toBe('critical');
  });

  describe('aggregateToRegions', () => {
    it('should use max frequency for region score', () => {
      const layer = new ChangeFrequencyLayer();
      const moduleScores = new Map<string, LayerScore>([
        ['a.ts', { value: 0.1, raw: 10, label: '10 commits', severity: 'info' }],
        ['b.ts', { value: 0.5, raw: 50, label: '50 commits', severity: 'warning' }],
        ['c.ts', { value: 1.0, raw: 100, label: '100 commits', severity: 'critical' }],
      ]);

      const regions: Region[] = [
        { id: 'core', name: 'Core', moduleCount: 3, loc: 300 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      const coreScore = regionScores.get('core')!;
      expect(coreScore.raw).toBe(100);
      expect(coreScore.value).toBe(1.0);
    });

    it('should skip empty regions', () => {
      const layer = new ChangeFrequencyLayer();
      const moduleScores = new Map<string, LayerScore>();
      const regions: Region[] = [
        { id: 'empty', name: 'Empty', moduleCount: 0, loc: 0 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.has('empty')).toBe(false);
    });
  });
});
