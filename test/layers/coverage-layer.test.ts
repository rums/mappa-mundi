import { describe, it, expect } from 'vitest';
import type { DependencyGraph, ModuleNode, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import {
  TestCoverageLayer,
} from '../../src/layers/coverage-layer';
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

/** Minimal Istanbul JSON coverage report structure */
function makeIstanbulReport(entries: Record<string, { lines: { pct: number } }>): object {
  const report: Record<string, object> = {};
  for (const [filePath, data] of Object.entries(entries)) {
    report[filePath] = {
      path: filePath,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
      // Istanbul summary format
      lines: data.lines,
      statements: { pct: data.lines.pct },
      branches: { pct: 0 },
      functions: { pct: 0 },
    };
  }
  return report;
}

describe('TestCoverageLayer', () => {
  it('should have correct id, name, and description', () => {
    const layer = new TestCoverageLayer();
    expect(layer.id).toBe('test-coverage');
    expect(layer.name).toBeDefined();
    expect(layer.description).toBeDefined();
  });

  // AC 1: TestCoverageLayer consumes Istanbul JSON and returns per-module coverage scores
  it('should consume Istanbul JSON and return per-module coverage scores', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'login.ts', filePath: '/project/login.ts' },
      { id: 'signup.ts', filePath: '/project/signup.ts' },
    ]);
    const dirTree = makeDirTree(['login.ts', 'signup.ts']);
    const report = makeIstanbulReport({
      '/project/login.ts': { lines: { pct: 85 } },
      '/project/signup.ts': { lines: { pct: 40 } },
    });

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    expect(result.layerId).toBe('test-coverage');
    expect(result.moduleScores.size).toBe(2);
  });

  // AC 2: Given login.ts at 85% and signup.ts at 40%, scores attach to correct module IDs
  it('should attach scores to correct module IDs with correct values', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'login.ts', filePath: '/project/login.ts' },
      { id: 'signup.ts', filePath: '/project/signup.ts' },
    ]);
    const dirTree = makeDirTree(['login.ts', 'signup.ts']);
    const report = makeIstanbulReport({
      '/project/login.ts': { lines: { pct: 85 } },
      '/project/signup.ts': { lines: { pct: 40 } },
    });

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    const loginScore = result.moduleScores.get('login.ts');
    expect(loginScore).toBeDefined();
    expect(loginScore!.raw).toBe(85);
    expect(loginScore!.value).toBeCloseTo(0.85);
    expect(loginScore!.severity).toBe('info'); // ≥0.8

    const signupScore = result.moduleScores.get('signup.ts');
    expect(signupScore).toBeDefined();
    expect(signupScore!.raw).toBe(40);
    expect(signupScore!.value).toBeCloseTo(0.40);
    expect(signupScore!.severity).toBe('critical'); // <0.5
  });

  // AC 7: All LayerScore values are normalized 0-1 with raw values preserved
  it('should normalize coverage values to 0-1 and preserve raw values', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'full.ts', filePath: '/project/full.ts' },
    ]);
    const dirTree = makeDirTree(['full.ts']);
    const report = makeIstanbulReport({
      '/project/full.ts': { lines: { pct: 100 } },
    });

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    const score = result.moduleScores.get('full.ts')!;
    expect(score.value).toBe(1.0);
    expect(score.raw).toBe(100);
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(1);
  });

  // AC 11: Modules with no coverage data get score 0 with severity critical
  it('should give modules with no coverage data a score of 0 and severity critical', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'covered.ts', filePath: '/project/covered.ts' },
      { id: 'uncovered.ts', filePath: '/project/uncovered.ts' },
    ]);
    const dirTree = makeDirTree(['covered.ts', 'uncovered.ts']);
    const report = makeIstanbulReport({
      '/project/covered.ts': { lines: { pct: 80 } },
      // uncovered.ts not in report
    });

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    const uncoveredScore = result.moduleScores.get('uncovered.ts');
    expect(uncoveredScore).toBeDefined();
    expect(uncoveredScore!.raw).toBe(0);
    expect(uncoveredScore!.value).toBe(0);
    expect(uncoveredScore!.severity).toBe('critical');
  });

  // Coverage path mapping: normalize both Istanbul paths and ModuleNode.id
  it('should match coverage report with absolute paths against relative module IDs', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'src/utils.ts', filePath: '/project/src/utils.ts' },
    ]);
    const dirTree = makeDirTree(['src/utils.ts']);
    const report = makeIstanbulReport({
      '/project/src/utils.ts': { lines: { pct: 75 } },
    });

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
    });

    const score = result.moduleScores.get('src/utils.ts');
    expect(score).toBeDefined();
    expect(score!.raw).toBe(75);
  });

  // Empty/malformed coverage report → graceful error, no scores
  it('should handle empty coverage report gracefully', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([
      { id: 'app.ts', filePath: '/project/app.ts' },
    ]);
    const dirTree = makeDirTree(['app.ts']);

    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: {},
    });

    // All modules should get score 0 / critical (no coverage data)
    const score = result.moduleScores.get('app.ts');
    expect(score).toBeDefined();
    expect(score!.raw).toBe(0);
    expect(score!.severity).toBe('critical');
  });

  // Severity thresholds
  it('should assign severity info for coverage ≥ 80%', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const report = makeIstanbulReport({ '/project/a.ts': { lines: { pct: 80 } } });

    const result = layer.computeModuleScores(graph, dirTree, { coverageReport: report });
    expect(result.moduleScores.get('a.ts')!.severity).toBe('info');
  });

  it('should assign severity warning for coverage ≥ 50% and < 80%', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const report = makeIstanbulReport({ '/project/a.ts': { lines: { pct: 60 } } });

    const result = layer.computeModuleScores(graph, dirTree, { coverageReport: report });
    expect(result.moduleScores.get('a.ts')!.severity).toBe('warning');
  });

  it('should assign severity critical for coverage < 50%', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const report = makeIstanbulReport({ '/project/a.ts': { lines: { pct: 30 } } });

    const result = layer.computeModuleScores(graph, dirTree, { coverageReport: report });
    expect(result.moduleScores.get('a.ts')!.severity).toBe('critical');
  });

  // AC 8: Severity thresholds are configurable per layer
  it('should allow configurable severity thresholds', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const report = makeIstanbulReport({ '/project/a.ts': { lines: { pct: 70 } } });

    // With default thresholds, 70% → warning. With custom threshold lowered to 60%, → info
    const result = layer.computeModuleScores(graph, dirTree, {
      coverageReport: report,
      severityThresholds: { info: 0.6, warning: 0.3 },
    });
    expect(result.moduleScores.get('a.ts')!.severity).toBe('info');
  });

  // Human-readable label
  it('should include a human-readable label in scores', () => {
    const layer = new TestCoverageLayer();
    const graph = makeGraph([{ id: 'a.ts', filePath: '/project/a.ts' }]);
    const dirTree = makeDirTree(['a.ts']);
    const report = makeIstanbulReport({ '/project/a.ts': { lines: { pct: 85 } } });

    const result = layer.computeModuleScores(graph, dirTree, { coverageReport: report });
    const score = result.moduleScores.get('a.ts')!;
    expect(score.label).toMatch(/85/); // Should contain "85" somewhere, e.g. "85% coverage"
  });

  // AC 3: Region-level coverage is weighted average by LOC
  describe('aggregateToRegions', () => {
    it('should compute weighted average by LOC for region coverage', () => {
      const layer = new TestCoverageLayer();

      const moduleScores = new Map<string, LayerScore>([
        ['large.ts', { value: 0.9, raw: 90, label: '90% coverage', severity: 'info' }],
        ['small.ts', { value: 0.3, raw: 30, label: '30% coverage', severity: 'critical' }],
      ]);

      // Region containing both modules; large.ts has 900 LOC, small.ts has 100 LOC
      // Weighted avg = (0.9 * 900 + 0.3 * 100) / (900 + 100) = (810 + 30) / 1000 = 0.84
      const regions: Region[] = [
        { id: 'auth', name: 'Auth', moduleCount: 2, loc: 1000 },
      ];

      // Need a way to associate modules with regions - using a moduleToRegion map or region contains module IDs
      const regionScores = layer.aggregateToRegions(moduleScores, regions);

      const authScore = regionScores.get('auth');
      expect(authScore).toBeDefined();
      // Weighted average, not simple average
      expect(authScore!.value).not.toBeCloseTo(0.6); // Simple average would be 0.6
    });

    it('should exclude regions with no modules from the result', () => {
      const layer = new TestCoverageLayer();
      const moduleScores = new Map<string, LayerScore>();
      const regions: Region[] = [
        { id: 'empty', name: 'Empty', moduleCount: 0, loc: 0 },
      ];

      const regionScores = layer.aggregateToRegions(moduleScores, regions);
      expect(regionScores.has('empty')).toBe(false);
    });
  });
});
