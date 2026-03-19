import type { DependencyGraph, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';
import type { Layer, LayerConfig, LayerResult, LayerScore, Severity } from './types';

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export class ComplexityLayer implements Layer {
  readonly id = 'complexity-hotspots';
  readonly name = 'Complexity Hotspots';
  readonly description = 'Flags modules with large functions based on LOC';

  computeModuleScores(
    graph: DependencyGraph,
    _dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult {
    const functionLocs = (config?.functionLocs ?? {}) as Record<string, number[]>;
    const threshold = (config?.threshold as number) ?? 50;

    const moduleScores = new Map<string, LayerScore>();

    for (const node of graph.nodes) {
      const locs = functionLocs[node.id] ?? [];
      let raw: number;
      let label: string;

      if (locs.length > 0) {
        // Pre-computed function LOC (TS full AST path)
        raw = Math.max(...locs);
        label = `${raw} LOC max function`;
      } else {
        // Estimate from symbol count — more symbols = more complex
        const symbolCount = node.symbols.length;
        const functionCount = node.symbols.filter(s => s.kind === 'function').length;
        const classCount = node.symbols.filter(s => s.kind === 'class' || s.kind === 'interface').length;
        raw = symbolCount + functionCount * 2 + classCount * 5;
        label = `${symbolCount} symbols (${functionCount} functions, ${classCount} types)`;
      }

      const value = Math.min(raw / 200, 1.0);
      const severity = this.getSeverity(raw, threshold);

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

      // Max severity, max raw, max value
      let worstSeverity: Severity = 'info';
      let maxRaw = 0;
      let maxValue = 0;

      for (const score of scores) {
        if (SEVERITY_ORDER[score.severity] > SEVERITY_ORDER[worstSeverity]) {
          worstSeverity = score.severity;
        }
        if (score.raw > maxRaw) maxRaw = score.raw;
        if (score.value > maxValue) maxValue = score.value;
      }

      const label = `${maxRaw} LOC max function`;
      result.set(region.id, {
        value: maxValue,
        raw: maxRaw,
        label,
        severity: worstSeverity,
      });
    }

    return result;
  }

  private getSeverity(raw: number, threshold: number): Severity {
    if (raw < threshold) return 'info';
    if (raw < threshold * 2) return 'warning';
    return 'critical';
  }
}
