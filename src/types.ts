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

export interface SymbolInfo {
  name: string;
  kind: 'interface' | 'function' | 'class' | 'enum' | 'type' | 'variable';
  signature: string;
  exported: boolean;
}

export interface ModuleNode {
  id: string;
  filePath: string;
  exports: ExportInfo[];
  symbols: SymbolInfo[];
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
