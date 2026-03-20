import type { DependencyGraph, Region } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types.js';

/**
 * Recent Activity layer — files changed in the last 30 days.
 * High score = active development happening here right now.
 */
export class RecentActivityLayer implements Layer {
  readonly id = 'git-recent-activity';
  readonly name = 'Recent Activity';
  readonly description = 'Files changed in the last 30 days — where active development is happening';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const activity = (config?.recentActivity ?? {}) as Record<string, number>;
    const moduleScores = new Map<string, LayerScore>();

    // Find max for normalization
    const values = Object.values(activity);
    const maxActivity = values.length > 0 ? Math.max(...values) : 1;

    for (const node of graph.nodes) {
      const raw = activity[node.id] ?? 0;
      const value = maxActivity > 0 ? Math.min(raw / maxActivity, 1.0) : 0;
      const severity = this.getSeverity(raw);
      const label = raw === 0 ? 'No recent changes' : `${raw} recent commits`;

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

      // Sum: total recent activity in the region
      const totalRaw = scores.reduce((sum, s) => sum + s.raw, 0);
      const maxValue = scores.reduce((mx, s) => Math.max(mx, s.value), 0);
      const severity = this.getSeverity(totalRaw);

      result.set(region.id, {
        value: maxValue,
        raw: totalRaw,
        label: `${totalRaw} recent commits (total)`,
        severity,
      });
    }

    return result;
  }

  private getSeverity(raw: number): Severity {
    // Activity is informational — more activity isn't necessarily bad
    if (raw === 0) return 'info';
    if (raw <= 5) return 'info';
    if (raw <= 15) return 'warning';
    return 'critical';
  }
}
