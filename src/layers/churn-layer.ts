import type { DependencyGraph, Region } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types.js';

/**
 * Churn layer — total lines added + removed per file across git history.
 * High churn = volatile code that's constantly being rewritten.
 */
export class ChurnLayer implements Layer {
  readonly id = 'git-churn';
  readonly name = 'Code Churn';
  readonly description = 'Total lines added + removed — identifies volatile, frequently rewritten code';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const churn = (config?.churn ?? {}) as Record<string, number>;
    const moduleScores = new Map<string, LayerScore>();

    // Normalize by max churn
    const values = Object.values(churn);
    const maxChurn = values.length > 0 ? Math.max(...values) : 1;

    for (const node of graph.nodes) {
      const raw = churn[node.id] ?? 0;
      const value = maxChurn > 0 ? Math.min(raw / maxChurn, 1.0) : 0;
      const severity = this.getSeverity(value);
      const label = raw === 0 ? 'No churn' : `${raw} lines churned`;

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

      // Max: show the most churned file in the region
      const max = scores.reduce((a, b) => (a.raw > b.raw ? a : b), scores[0]);
      result.set(region.id, {
        value: max.value,
        raw: max.raw,
        label: `${max.raw} lines churned (max)`,
        severity: max.severity,
      });
    }

    return result;
  }

  private getSeverity(value: number): Severity {
    if (value < 0.33) return 'info';
    if (value < 0.66) return 'warning';
    return 'critical';
  }
}
