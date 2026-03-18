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

/**
 * SemanticZoomLevel data model (from Spec #4 / Issue #15).
 * Used by the canvas renderer for region visualization.
 */

export type RelationshipKind = 'depends-on' | 'extends' | 'implements' | 'uses';

export interface Region {
  id: string;
  name: string;
  moduleCount: number;
  loc: number;
}

export interface Relationship {
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
  edgeCount: number;
}

export interface SemanticZoomLevel {
  id: string;
  label: string;
  regions: Region[];
  relationships: Relationship[];
}
