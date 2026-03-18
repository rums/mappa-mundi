import type { DependencyGraph, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types';

interface CoverageEntry {
  lines: { pct: number };
  [key: string]: unknown;
}

export class TestCoverageLayer implements Layer {
  readonly id = 'test-coverage';
  readonly name = 'Test Coverage';
  readonly description = 'Measures test coverage per module using Istanbul JSON reports';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const report = (config?.coverageReport ?? {}) as Record<string, CoverageEntry>;
    const thresholds = config?.severityThresholds as
      | { info: number; warning: number }
      | undefined;

    const infoThreshold = thresholds?.info ?? 0.8;
    const warningThreshold = thresholds?.warning ?? 0.5;

    // Build a lookup from filePath to coverage entry
    const coverageByPath = new Map<string, CoverageEntry>();
    for (const [filePath, entry] of Object.entries(report)) {
      coverageByPath.set(filePath, entry);
    }

    const moduleScores = new Map<string, LayerScore>();

    for (const node of graph.nodes) {
      const entry = coverageByPath.get(node.filePath);
      const raw = entry?.lines?.pct ?? 0;
      const value = raw / 100;
      const severity = this.getSeverity(value, infoThreshold, warningThreshold);
      const label = `${raw}% coverage`;

      moduleScores.set(node.id, { value, raw, label, severity });
    }

    return { layerId: this.id, moduleScores };
  }

  aggregateToRegions(
    moduleScores: Map<string, LayerScore>,
    regions: Region[],
  ): Map<string, LayerScore> {
    const result = new Map<string, LayerScore>();

    for (const region of regions) {
      if (region.moduleCount === 0) continue;

      const scores = Array.from(moduleScores.values());
      if (scores.length === 0) continue;

      // Weighted average using raw coverage as weight proxy for LOC
      let weightedSum = 0;
      let weightSum = 0;
      for (const score of scores) {
        // Use raw as weight (higher coverage modules tend to be larger)
        const weight = score.raw || 1;
        weightedSum += score.value * weight;
        weightSum += weight;
      }

      const value = weightSum > 0 ? weightedSum / weightSum : 0;
      const raw = value * 100;
      const severity = this.getSeverity(value, 0.8, 0.5);
      const label = `${Math.round(raw)}% coverage`;

      result.set(region.id, { value, raw, label, severity });
    }

    return result;
  }

  private getSeverity(
    value: number,
    infoThreshold: number,
    warningThreshold: number,
  ): Severity {
    if (value >= infoThreshold) return 'info';
    if (value >= warningThreshold) return 'warning';
    return 'critical';
  }
}
