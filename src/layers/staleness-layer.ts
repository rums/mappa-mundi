import type { DependencyGraph, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class GitStalenessLayer implements Layer {
  readonly id = 'git-staleness';
  readonly name = 'Git Staleness';
  readonly description = 'Measures days since last commit per module';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const timestamps = (config?.gitTimestamps ?? {}) as Record<string, number>;
    const thresholds = config?.severityThresholds as
      | { info: number; warning: number }
      | undefined;

    const infoThreshold = thresholds?.info ?? 90;
    const warningThreshold = thresholds?.warning ?? 180;

    const now = Date.now();
    const moduleScores = new Map<string, LayerScore>();

    for (const node of graph.nodes) {
      const timestamp = timestamps[node.id];
      if (timestamp === undefined) {
        // Untracked
        moduleScores.set(node.id, {
          value: 0,
          raw: 0,
          label: 'Untracked',
          severity: 'info',
        });
        continue;
      }

      const raw = Math.round((now - timestamp) / MS_PER_DAY);
      const value = Math.min(raw / 365, 1.0);
      const severity = this.getSeverity(raw, infoThreshold, warningThreshold);
      const label = `${raw} days since last commit`;

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

      // Median by raw
      const sorted = scores.slice().sort((a, b) => a.raw - b.raw);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? (sorted[mid - 1].raw + sorted[mid].raw) / 2
          : sorted[mid].raw;

      const value = Math.min(median / 365, 1.0);
      const severity = this.getSeverity(median, 90, 180);
      const label = `${median} days (median)`;

      result.set(region.id, { value, raw: median, label, severity });
    }

    return result;
  }

  private getSeverity(
    days: number,
    infoThreshold: number,
    warningThreshold: number,
  ): Severity {
    if (days <= infoThreshold) return 'info';
    if (days <= warningThreshold) return 'warning';
    return 'critical';
  }
}
