import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { RecentActivityLayer } from '../../src/layers/recent-activity-layer';
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

describe('RecentActivityLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new RecentActivityLayer();
    expect(layer.id).toBe('git-recent-activity');
    expect(layer.name).toBe('Recent Activity');
    expect(layer.description).toBeDefined();
  });

  it('should normalize scores relative to max recent activity', () => {
    const layer = new RecentActivityLayer();
    const graph = makeGraph([
      { id: 'active.ts', filePath: '/project/active.ts' },
      { id: 'quiet.ts', filePath: '/project/quiet.ts' },
    ]);
    const dirTree = makeDirTree(['active.ts', 'quiet.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      recentActivity: { 'active.ts': 20, 'quiet.ts': 2 },
    });

    expect(result.moduleScores.get('active.ts')!.value).toBe(1.0);
    expect(result.moduleScores.get('active.ts')!.raw).toBe(20);
    expect(result.moduleScores.get('quiet.ts')!.value).toBeCloseTo(0.1);
  });

  it('should mark files with no recent changes', () => {
    const layer = new RecentActivityLayer();
    const graph = makeGraph([{ id: 'old.ts', filePath: '/project/old.ts' }]);
    const dirTree = makeDirTree(['old.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      recentActivity: {},
    });

    const score = result.moduleScores.get('old.ts')!;
    expect(score.raw).toBe(0);
    expect(score.value).toBe(0);
    expect(score.label).toBe('No recent changes');
  });

  it('should assign severity based on raw commit count', () => {
    const layer = new RecentActivityLayer();
    const graph = makeGraph([
      { id: 'none.ts', filePath: '/project/none.ts' },
      { id: 'some.ts', filePath: '/project/some.ts' },
      { id: 'lots.ts', filePath: '/project/lots.ts' },
    ]);
    const dirTree = makeDirTree(['none.ts', 'some.ts', 'lots.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      recentActivity: { 'none.ts': 0, 'some.ts': 10, 'lots.ts': 20 },
    });

    expect(result.moduleScores.get('none.ts')!.severity).toBe('info');
    expect(result.moduleScores.get('some.ts')!.severity).toBe('warning');
    expect(result.moduleScores.get('lots.ts')!.severity).toBe('critical');
  });

  describe('aggregateToRegions', () => {
    it('should sum recent activity for region score', () => {
      const layer = new RecentActivityLayer();
      const moduleScores = new Map<string, LayerScore>([
        ['a.ts', { value: 0.5, raw: 5, label: '5 recent commits', severity: 'info' }],
        ['b.ts', { value: 1.0, raw: 10, label: '10 recent commits', severity: 'warning' }],
      ]);

      const regions: Region[] = [
        { id: 'core', name: 'Core', moduleCount: 2, loc: 200 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      const coreScore = regionScores.get('core')!;
      expect(coreScore.raw).toBe(15); // sum
      expect(coreScore.value).toBe(1.0); // max value
    });
  });
});
