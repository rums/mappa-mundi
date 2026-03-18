import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { ComplexityLayer } from '../../src/layers/complexity-layer';
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

describe('ComplexityLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new ComplexityLayer();
    expect(layer.id).toBe('complexity-hotspots');
    expect(layer.name).toBeDefined();
    expect(layer.description).toBeDefined();
  });

  // AC 6: ComplexityLayer flags modules with functions > 50 LOC (configurable threshold)
  it('should flag module with a 60-line function as severity warning', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'big-fn.ts', filePath: '/project/big-fn.ts' },
    ]);
    const dirTree = makeDirTree(['big-fn.ts']);

    // Provide pre-analyzed function LOC data so the layer doesn't need SWC in tests
    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: {
        'big-fn.ts': [60], // one function with 60 LOC
      },
    });

    const score = result.moduleScores.get('big-fn.ts');
    expect(score).toBeDefined();
    expect(score!.raw).toBe(60); // max function LOC in module
    expect(score!.severity).toBe('warning'); // 50-99 → warning
  });

  // Module with 150-line function → severity critical
  it('should assign severity critical for modules with functions ≥ 100 LOC', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'huge-fn.ts', filePath: '/project/huge-fn.ts' },
    ]);
    const dirTree = makeDirTree(['huge-fn.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: {
        'huge-fn.ts': [150], // one function with 150 LOC
      },
    });

    const score = result.moduleScores.get('huge-fn.ts')!;
    expect(score.raw).toBe(150);
    expect(score.severity).toBe('critical');
  });

  // Module with all functions < 50 LOC → severity info
  it('should assign severity info for modules with all functions < 50 LOC', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'small-fns.ts', filePath: '/project/small-fns.ts' },
    ]);
    const dirTree = makeDirTree(['small-fns.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: {
        'small-fns.ts': [10, 20, 30], // all under 50
      },
    });

    const score = result.moduleScores.get('small-fns.ts')!;
    expect(score.raw).toBe(30); // max function LOC
    expect(score.severity).toBe('info');
  });

  // Raw is max function LOC, value is normalized min(raw/200, 1.0)
  it('should normalize complexity value as min(raw/200, 1.0)', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'a.ts', filePath: '/project/a.ts' },
    ]);
    const dirTree = makeDirTree(['a.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'a.ts': [60] },
    });

    const score = result.moduleScores.get('a.ts')!;
    expect(score.value).toBeCloseTo(60 / 200); // 0.3
    expect(score.raw).toBe(60);
  });

  it('should cap complexity value at 1.0 for functions ≥ 200 LOC', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'monster.ts', filePath: '/project/monster.ts' },
    ]);
    const dirTree = makeDirTree(['monster.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'monster.ts': [300] },
    });

    const score = result.moduleScores.get('monster.ts')!;
    expect(score.raw).toBe(300);
    expect(score.value).toBe(1.0);
  });

  // Configurable threshold: set to 30 → more flags
  it('should use configurable threshold for severity assignment', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'medium.ts', filePath: '/project/medium.ts' },
    ]);
    const dirTree = makeDirTree(['medium.ts']);

    // With default threshold (50), 40 LOC → info
    // With threshold set to 30, 40 LOC → warning
    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'medium.ts': [40] },
      threshold: 30,
    });

    const score = result.moduleScores.get('medium.ts')!;
    expect(score.severity).toBe('warning'); // exceeds threshold of 30
  });

  // Module with multiple functions — raw = max
  it('should use the max function LOC as the module raw score', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([
      { id: 'multi.ts', filePath: '/project/multi.ts' },
    ]);
    const dirTree = makeDirTree(['multi.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'multi.ts': [10, 80, 30] }, // max is 80
    });

    const score = result.moduleScores.get('multi.ts')!;
    expect(score.raw).toBe(80);
  });

  // Human-readable label
  it('should include a human-readable label', () => {
    const layer = new ComplexityLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'a.ts': [60] },
    });

    expect(result.moduleScores.get('a.ts')!.label).toBeDefined();
    expect(result.moduleScores.get('a.ts')!.label.length).toBeGreaterThan(0);
  });

  // AC 6 (aggregation): Region aggregation uses max severity
  describe('aggregateToRegions', () => {
    it('should use max severity in region for complexity aggregation', () => {
      const layer = new ComplexityLayer();

      const moduleScores = new Map<string, LayerScore>([
        ['clean.ts', { value: 0.1, raw: 20, label: '20 LOC', severity: 'info' }],
        ['messy.ts', { value: 0.5, raw: 100, label: '100 LOC', severity: 'critical' }],
      ]);

      const regions: Region[] = [
        { id: 'utils', name: 'Utils', moduleCount: 2, loc: 200 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);

      const utilsScore = regionScores.get('utils');
      expect(utilsScore).toBeDefined();
      // If any module is critical, region is critical
      expect(utilsScore!.severity).toBe('critical');
    });

    it('should exclude regions with no modules', () => {
      const layer = new ComplexityLayer();
      const moduleScores = new Map<string, LayerScore>();
      const regions: Region[] = [
        { id: 'empty', name: 'Empty', moduleCount: 0, loc: 0 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.has('empty')).toBe(false);
    });
  });
});
