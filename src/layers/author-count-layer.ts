import type { DependencyGraph, Region } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types.js';

/**
 * Author Count layer — unique authors who have touched each file.
 * High count = coordination bottleneck or shared ownership.
 * Low count (1) = bus factor risk.
 */
export class AuthorCountLayer implements Layer {
  readonly id = 'git-author-count';
  readonly name = 'Author Count';
  readonly description = 'Unique authors per file — identifies bus factor risks and coordination bottlenecks';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const authorCounts = (config?.authorCount ?? {}) as Record<string, number>;
    const moduleScores = new Map<string, LayerScore>();

    // Normalize by max author count
    const values = Object.values(authorCounts);
    const maxAuthors = values.length > 0 ? Math.max(...values) : 1;

    for (const node of graph.nodes) {
      const raw = authorCounts[node.id] ?? 0;
      const value = maxAuthors > 0 ? Math.min(raw / maxAuthors, 1.0) : 0;
      const severity = this.getSeverity(raw);
      const label = raw === 0
        ? 'No git history'
        : raw === 1
          ? '1 author (bus factor risk)'
          : `${raw} authors`;

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

      // Max: show the file with most authors in the region
      const max = scores.reduce((a, b) => (a.raw > b.raw ? a : b), scores[0]);
      result.set(region.id, {
        value: max.value,
        raw: max.raw,
        label: `${max.raw} authors (max)`,
        severity: max.severity,
      });
    }

    return result;
  }

  private getSeverity(raw: number): Severity {
    if (raw <= 1) return 'info';       // single author or no history
    if (raw <= 5) return 'warning';     // moderate collaboration
    return 'critical';                  // many-author coordination point
  }
}
