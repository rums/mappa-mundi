import type { DependencyGraph, Region } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types.js';

/**
 * Change Frequency layer — how often each file appears in git commits.
 * High frequency = hotspot that gets touched repeatedly.
 */
export class ChangeFrequencyLayer implements Layer {
  readonly id = 'git-change-frequency';
  readonly name = 'Change Frequency';
  readonly description = 'How often each file is changed in git history (commit count)';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const frequency = (config?.changeFrequency ?? {}) as Record<string, number>;
    const moduleScores = new Map<string, LayerScore>();

    // Find max for normalization
    const values = Object.values(frequency);
    const maxFreq = values.length > 0 ? Math.max(...values) : 1;

    for (const node of graph.nodes) {
      const raw = frequency[node.id] ?? 0;
      const value = maxFreq > 0 ? Math.min(raw / maxFreq, 1.0) : 0;
      const severity = this.getSeverity(value);
      const label = raw === 0 ? 'No commits' : `${raw} commits`;

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

      // Max: show the hottest file in the region
      const max = scores.reduce((a, b) => (a.raw > b.raw ? a : b), scores[0]);
      result.set(region.id, {
        value: max.value,
        raw: max.raw,
        label: `${max.raw} commits (max)`,
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
