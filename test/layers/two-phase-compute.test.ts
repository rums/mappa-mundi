import { describe, it, expect } from 'vitest';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import { TestCoverageLayer } from '../../src/layers/coverage-layer';
import { GitStalenessLayer } from '../../src/layers/staleness-layer';
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

describe('Two-phase compute', () => {
  // computeModuleScores works without SemanticRegion data
  it('should compute module scores without requiring SemanticRegion data', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'app.ts', filePath: '/project/app.ts' },
    ]);
    const dirTree = makeDirTree(['app.ts']);

    const report = {
      '/project/app.ts': {
        path: '/project/app.ts',
        statementMap: {}, fnMap: {}, branchMap: {},
        s: {}, f: {}, b: {},
        lines: { pct: 75 },
        statements: { pct: 75 }, branches: { pct: 0 }, functions: { pct: 0 },
      },
    };

    // No regions needed for this phase
    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    expect(result.moduleScores.size).toBe(1);
    expect(result.moduleScores.get('app.ts')).toBeDefined();
  });

  // aggregateToRegions works with pre-computed module scores
  it('should aggregate pre-computed module scores to regions', () => {
    const layer = new TestCoverageLayer();

    const moduleScores = new Map<string, LayerScore>([
      ['a.ts', { value: 0.8, raw: 80, label: '80% coverage', severity: 'info' }],
    ]);

    const regions: Region[] = [
      { id: 'core', name: 'Core', moduleCount: 1, loc: 100 },
    ];

    const regionScores = layer.aggregateToRegions(moduleScores, regions);
    expect(regionScores).toBeDefined();
    expect(regionScores instanceof Map).toBe(true);
  });

  // Region with no modules → no score (excluded from map)
  it('should not include score for region with no matching modules', () => {
    const layer = new TestCoverageLayer();
    const moduleScores = new Map<string, LayerScore>();

    const regions: Region[] = [
      { id: 'empty-region', name: 'Empty', moduleCount: 0, loc: 0 },
    ];

    const regionScores = layer.aggregateToRegions(moduleScores, regions);
    expect(regionScores.has('empty-region')).toBe(false);
  });

  // AC 10: Layers compute independently — enabling one doesn't affect another
  it('should allow layers to compute independently without interference', () => {
    const coverageLayer = new TestCoverageLayer();
    const complexityLayer = new ComplexityLayer();

    const graph = makeGraph([
      { id: 'app.ts', filePath: '/project/app.ts' },
    ]);
    const dirTree = makeDirTree(['app.ts']);

    const coverageResult = coverageLayer.computeModuleScores(graph, dirTree, {
      coverageReport: {
        '/project/app.ts': {
          path: '/project/app.ts',
          statementMap: {}, fnMap: {}, branchMap: {},
          s: {}, f: {}, b: {},
          lines: { pct: 90 },
          statements: { pct: 90 }, branches: { pct: 0 }, functions: { pct: 0 },
        },
      },
    });

    const complexityResult = complexityLayer.computeModuleScores(graph, dirTree, {
      functionLocs: { 'app.ts': [60] },
    });

    // Each layer produces its own independent result
    expect(coverageResult.layerId).toBe('test-coverage');
    expect(complexityResult.layerId).toBe('complexity-hotspots');

    // Coverage result is about coverage, not complexity
    expect(coverageResult.moduleScores.get('app.ts')!.raw).toBe(90);
    // Complexity result is about LOC, not coverage
    expect(complexityResult.moduleScores.get('app.ts')!.raw).toBe(60);
  });
});
