/**
 * Stub types for Atom-Compound Semantic Zoom Model (Spec 16).
 *
 * These types define the contract that the implementation must fulfill.
 * They are used by tests only — the implementation will provide the real types.
 */

import type { DependencyGraph, ImportEdge, ModuleNode } from '../../../src/types';
import type { DirectoryNode } from '../../../src/directory-tree';

// ─── Data Model ──────────────────────────────────────────────────────────────

export interface Atom {
  id: string;
  label: string;
  filePath: string;
  metadata?: {
    loc?: number;
    exportedSymbols?: string[];
  };
}

export interface Reference {
  atomId: string;
  weight: number; // 0-1
}

export interface Compound {
  id: string;
  name: string;
  summary: string;
  atomIds: string[];
  references: Reference[];
  zoomable: boolean;
  doi?: number;
}

export interface StratumQuality {
  mq: number;
  directoryAlignment: number;
  source: 'llm' | 'structural' | 'fallback-directory' | 'fallback-flat';
}

export interface Breadcrumb {
  compoundId: string;
  compoundName: string;
  depth: number;
}

export interface StratumRelationship {
  sourceId: string;
  targetId: string;
  kind: 'depends-on' | 'extends' | 'uses';
  edgeCount: number;
}

export interface Stratum {
  depth: number;
  parentCompoundId: string | null;
  compounds: Compound[];
  relationships: StratumRelationship[];
  breadcrumbs: Breadcrumb[];
  sourceHash: string;
  quality: StratumQuality;
  generatedAt: string;
}

export interface SemanticMap {
  projectId: string;
  atomType: 'file' | 'symbol';
  atoms: Atom[];
  strata: Record<string, Stratum>;
  generatedAt: string;
}

export interface StructuralPartition {
  clusters: string[][];
  algorithm: 'leiden' | 'infomap';
  resolution: number;
}

export interface AtomDiff {
  added: string[];
  removed: string[];
  edgesChanged: number;
}

export interface ZoomConfig {
  minCompoundSize: number;
  maxStratumDepth: number;
  maxRetries: number;
}

export interface ZoomResponse {
  stratum: Stratum;
  stale: boolean;
}

export interface OverviewCompound {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  atomCount: number;
  zoomable: boolean;
  loaded: boolean;
}

export interface MapOverview {
  compounds: OverviewCompound[];
}

export interface ValidationResult<T> {
  valid: boolean;
  data: T;
  fixes: string[];
}

// ─── LLM Client (reuse existing pattern) ─────────────────────────────────────

export interface LLMResponse {
  content: unknown;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMClient {
  complete(prompt: string, responseSchema: object): Promise<LLMResponse>;
}

// ─── Zoom Cache (new interface for atom-compound model) ──────────────────────

export interface StratumCache {
  get(projectId: string, parentCompoundId: string, atomType: string): { stratum: Stratum; stale: boolean } | null;
  set(projectId: string, parentCompoundId: string, atomType: string, stratum: Stratum): void;
  invalidateDescendants(projectId: string, compoundId: string): number;
  clear(projectId: string): void;
}
