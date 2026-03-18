import type { DependencyGraph, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';

export type Severity = 'info' | 'warning' | 'critical';

export interface LayerScore {
  value: number;
  raw: number;
  label: string;
  severity: Severity;
}

export interface LayerResult {
  layerId: string;
  moduleScores: Map<string, LayerScore>;
}

export interface LayerConfig {
  [key: string]: unknown;
}

export interface Layer {
  id: string;
  name: string;
  description: string;
  computeModuleScores(
    graph: DependencyGraph,
    dirTree: DirectoryNode,
    config?: LayerConfig,
  ): LayerResult;
  aggregateToRegions(
    moduleScores: Map<string, LayerScore>,
    regions: Region[],
  ): Map<string, LayerScore>;
}
