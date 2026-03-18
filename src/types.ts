// Types for the Module Dependency Graph
// This file defines the data model — implementation is pending.

export interface ImportInfo {
  name: string;
  alias?: string;
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 'type-only';
}

export interface ExportInfo {
  name: string;
  alias?: string;
  kind: 'named' | 'default' | 're-export';
  source?: string;
}

export interface ModuleNode {
  id: string;
  filePath: string;
  exports: ExportInfo[];
}

export interface ImportEdge {
  source: string;
  target: string;
  imports: ImportInfo[];
}

export interface DependencyGraph {
  root: string;
  nodes: ModuleNode[];
  edges: ImportEdge[];
}

export interface ScanOptions {
  excludeTests?: boolean;
  tsConfigPath?: string;
}
