import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { GitStalenessLayer } from '../../src/layers/staleness-layer';
import type { LayerScore } from '../../src/layers/types';

// --- Helpers ---

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

describe('GitStalenessLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new GitStalenessLayer();
    expect(layer.id).toBe('git-staleness');
    expect(layer.name).toBeDefined();
    expect(layer.description).toBeDefined();
  });

  // AC 4: GitStalenessLayer reports days-since-last-commit per file (90 days ago → raw: 90)
  it('should report days since last commit per file', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'old-file.ts', filePath: '/project/old-file.ts' },
    ]);
    const dirTree = makeDirTree(['old-file.ts']);

    // Provide git timestamps so the layer doesn't need to shell out in tests
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'old-file.ts': ninetyDaysAgo },
    });

    const score = result.moduleScores.get('old-file.ts');
    expect(score).toBeDefined();
    expect(score!.raw).toBeCloseTo(90, 0); // days
    expect(score!.value).toBeCloseTo(90 / 365, 1); // normalized
  });

  // Staleness: ≤90 days → info
  it('should assign severity info for files ≤ 90 days old', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'recent.ts', filePath: '/project/recent.ts' },
    ]);
    const dirTree = makeDirTree(['recent.ts']);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'recent.ts': thirtyDaysAgo },
    });

    expect(result.moduleScores.get('recent.ts')!.severity).toBe('info');
  });

  // Staleness: ≤180 → warning
  it('should assign severity warning for files 91-180 days old', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'aging.ts', filePath: '/project/aging.ts' },
    ]);
    const dirTree = makeDirTree(['aging.ts']);

    const oneHundredFiftyDaysAgo = Date.now() - 150 * 24 * 60 * 60 * 1000;
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'aging.ts': oneHundredFiftyDaysAgo },
    });

    expect(result.moduleScores.get('aging.ts')!.severity).toBe('warning');
  });

  // Staleness: >180 → critical
  it('should assign severity critical for files > 180 days old', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'stale.ts', filePath: '/project/stale.ts' },
    ]);
    const dirTree = makeDirTree(['stale.ts']);

    const twoHundredDaysAgo = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'stale.ts': twoHundredDaysAgo },
    });

    expect(result.moduleScores.get('stale.ts')!.severity).toBe('critical');
  });

  // File last modified 400 days ago → raw: 400, value: 1.0 (capped)
  it('should cap staleness value at 1.0 for files older than 365 days', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'ancient.ts', filePath: '/project/ancient.ts' },
    ]);
    const dirTree = makeDirTree(['ancient.ts']);

    const fourHundredDaysAgo = Date.now() - 400 * 24 * 60 * 60 * 1000;
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'ancient.ts': fourHundredDaysAgo },
    });

    const score = result.moduleScores.get('ancient.ts')!;
    expect(score.raw).toBeCloseTo(400, 0);
    expect(score.value).toBe(1.0); // capped
  });

  // AC 12: Untracked files get staleness raw=0, severity info
  it('should give untracked files raw=0 and severity info', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([
      { id: 'new-file.ts', filePath: '/project/new-file.ts' },
    ]);
    const dirTree = makeDirTree(['new-file.ts']);

    // No gitTimestamps entry for new-file.ts → untracked
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: {},
    });

    const score = result.moduleScores.get('new-file.ts');
    expect(score).toBeDefined();
    expect(score!.raw).toBe(0);
    expect(score!.severity).toBe('info');
  });

  // Human-readable label
  it('should include a human-readable label', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'a.ts': ninetyDaysAgo },
    });

    expect(result.moduleScores.get('a.ts')!.label).toBeDefined();
    expect(result.moduleScores.get('a.ts')!.label.length).toBeGreaterThan(0);
  });

  // AC 8: Configurable severity thresholds
  it('should support configurable severity thresholds', async () => {
    const layer = new GitStalenessLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const oneHundredDaysAgo = Date.now() - 100 * 24 * 60 * 60 * 1000;

    // Default: 100 days → warning. Custom: raise info threshold to 120 → info
    const result = layer.computeModuleScores(graph, dirTree, {
      gitTimestamps: { 'a.ts': oneHundredDaysAgo },
      severityThresholds: { info: 120, warning: 240 },
    });

    expect(result.moduleScores.get('a.ts')!.severity).toBe('info');
  });

  // AC 5: Region-level staleness is the median of contained files
  describe('aggregateToRegions', () => {
    it('should compute median staleness for regions', () => {
      const layer = new GitStalenessLayer();

      // 3 files: 10, 50, 200 days stale → median = 50
      const moduleScores = new Map<string, LayerScore>([
        ['a.ts', { value: 10 / 365, raw: 10, label: '10 days', severity: 'info' }],
        ['b.ts', { value: 50 / 365, raw: 50, label: '50 days', severity: 'info' }],
        ['c.ts', { value: 200 / 365, raw: 200, label: '200 days', severity: 'critical' }],
      ]);

      const regions: Region[] = [
        { id: 'core', name: 'Core', moduleCount: 3, loc: 300 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);

      const coreScore = regionScores.get('core');
      expect(coreScore).toBeDefined();
      // Median of [10, 50, 200] = 50
      expect(coreScore!.raw).toBe(50);
    });

    it('should exclude regions with no modules', () => {
      const layer = new GitStalenessLayer();
      const moduleScores = new Map<string, LayerScore>();
      const regions: Region[] = [
        { id: 'empty', name: 'Empty', moduleCount: 0, loc: 0 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.has('empty')).toBe(false);
    });
  });
});
