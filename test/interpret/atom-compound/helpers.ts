/**
 * Test helpers for Atom-Compound Semantic Zoom tests.
 * Follows existing test helper patterns in the codebase.
 */

import { vi } from 'vitest';
import type { DependencyGraph, ImportEdge, ModuleNode } from '../../../src/types';
import type { DirectoryNode } from '../../../src/directory-tree';
import type {
  Atom,
  Compound,
  Stratum,
  StratumQuality,
  Breadcrumb,
  Reference,
  LLMClient,
  LLMResponse,
  StratumCache,
  ZoomConfig,
  StructuralPartition,
  StratumRelationship,
} from './types';

// ─── Module / Graph Helpers ─────────────────────────────────────────────────

export function makeModule(id: string, symbols: ModuleNode['symbols'] = []): ModuleNode {
  return {
    id,
    filePath: `/project/${id}`,
    exports: [],
    symbols,
  };
}

export function makeEdge(source: string, target: string): ImportEdge {
  return {
    source,
    target,
    imports: [{ name: 'default', kind: 'named' }],
  };
}

export function makeDirNode(
  name: string,
  path: string,
  files: string[] = [],
  children: DirectoryNode[] = [],
): DirectoryNode {
  return {
    name,
    path,
    files,
    children,
    isBoundary: false,
    metrics: {
      fileCount: files.length,
      totalLoc: files.length * 50,
      fileCountByExtension: { '.ts': files.length },
      exportedSymbolCount: files.length * 2,
      subtreeFileCount: files.length,
      subtreeLoc: files.length * 50,
      subtreeExportedSymbolCount: files.length * 2,
      inboundEdges: 0,
      outboundEdges: 0,
    },
  };
}

// ─── Atom Helpers ───────────────────────────────────────────────────────────

export function makeAtom(id: string, filePath?: string, loc?: number, symbols?: string[]): Atom {
  return {
    id,
    label: id.split('/').pop() || id,
    filePath: filePath ?? `/project/${id}`,
    metadata: {
      loc: loc ?? 50,
      exportedSymbols: symbols ?? [],
    },
  };
}

export function makeAtoms(count: number, prefix = 'src/file'): Atom[] {
  return Array.from({ length: count }, (_, i) =>
    makeAtom(`${prefix}${i}.ts`, `/project/${prefix}${i}.ts`, 50 + i * 10, [`fn${i}`]),
  );
}

// ─── Compound Helpers ───────────────────────────────────────────────────────

export function makeCompound(
  overrides: Partial<Compound> & { atomIds: string[] },
): Compound {
  return {
    id: overrides.id ?? `c-${overrides.atomIds.sort().join('').slice(0, 12)}`,
    name: overrides.name ?? 'Test Compound',
    summary: overrides.summary ?? 'Test compound summary',
    atomIds: overrides.atomIds,
    references: overrides.references ?? [],
    zoomable: overrides.zoomable ?? true,
    doi: overrides.doi,
  };
}

// ─── Graph Builders ─────────────────────────────────────────────────────────

/** Build a project with N atoms across subdirs */
export function buildProject(atomCount: number, subdirs: number = 3): {
  graph: DependencyGraph;
  dirTree: DirectoryNode;
  atoms: Atom[];
} {
  const atomsPerDir = Math.ceil(atomCount / subdirs);
  const moduleIds: string[] = [];
  const dirChildren: DirectoryNode[] = [];

  for (let d = 0; d < subdirs; d++) {
    const dirName = `dir${d}`;
    const dirFiles: string[] = [];
    for (let f = 0; f < atomsPerDir && moduleIds.length < atomCount; f++) {
      const id = `src/${dirName}/file${f}.ts`;
      moduleIds.push(id);
      dirFiles.push(id);
    }
    dirChildren.push(makeDirNode(dirName, `src/${dirName}`, dirFiles));
  }

  const modules = moduleIds.map((id) =>
    makeModule(id, [
      { name: id.split('/').pop()!.replace('.ts', ''), kind: 'function', signature: '(): void', exported: true },
    ]),
  );

  // Create some cross-directory edges
  const edges: ImportEdge[] = [];
  for (let i = 1; i < modules.length; i += 3) {
    edges.push(makeEdge(modules[i].id, modules[(i + atomsPerDir) % modules.length].id));
  }

  const graph: DependencyGraph = { root: '/project', nodes: modules, edges };
  const dirTree = makeDirNode('src', 'src', [], dirChildren);
  const atoms = moduleIds.map((id) => makeAtom(id));

  return { graph, dirTree, atoms };
}

/** Build a 50-atom project for stratum 0 tests */
export function build50AtomProject() {
  return buildProject(50, 5);
}

/** Build a 20-atom project for zoom tests */
export function build20AtomProject() {
  return buildProject(20, 3);
}

// ─── Mock LLM Helpers ───────────────────────────────────────────────────────

/** LLM that returns valid compound groupings */
export function createSuccessLLM(
  compounds: Array<{ name: string; summary: string; atomIds: string[]; references?: string[] }>,
): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: { compounds },
      usage: { promptTokens: 1000, completionTokens: 200 },
    } satisfies LLMResponse),
  };
}

/** LLM that always throws (network error, etc.) */
export function createFailingLLM(): LLMClient {
  return {
    complete: vi.fn().mockRejectedValue(new Error('Network error: connection refused')),
  };
}

/** LLM that returns all atoms in one compound (no progress) */
export function createNoProgressLLM(allAtomIds: string[]): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: {
        compounds: [
          { name: 'Everything', summary: 'All atoms', atomIds: allAtomIds, references: [] },
        ],
      },
      usage: { promptTokens: 1000, completionTokens: 100 },
    } satisfies LLMResponse),
  };
}

/** LLM that returns invalid JSON */
export function createInvalidJsonLLM(): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: 'not valid json {{{',
      usage: { promptTokens: 1000, completionTokens: 50 },
    } satisfies LLMResponse),
  };
}

/** LLM that returns out-of-scope atoms in atomIds */
export function createOutOfScopeLLM(
  inScopeAtoms: string[],
  outOfScopeAtom: string,
): LLMClient {
  const half = Math.ceil(inScopeAtoms.length / 2);
  return {
    complete: vi.fn().mockResolvedValue({
      content: {
        compounds: [
          {
            name: 'Group A',
            summary: 'First group',
            atomIds: [...inScopeAtoms.slice(0, half), outOfScopeAtom], // includes out-of-scope
            references: [],
          },
          {
            name: 'Group B',
            summary: 'Second group',
            atomIds: inScopeAtoms.slice(half),
            references: [],
          },
        ],
      },
      usage: { promptTokens: 1000, completionTokens: 200 },
    } satisfies LLMResponse),
  };
}

// ─── Mock Cache ─────────────────────────────────────────────────────────────

export function createMockStratumCache(): StratumCache {
  const store = new Map<string, { stratum: Stratum; stale: boolean }>();
  return {
    get: vi.fn((projectId: string, parentCompoundId: string, atomType: string) => {
      const key = `${projectId}::${parentCompoundId}::${atomType}`;
      return store.get(key) ?? null;
    }),
    set: vi.fn((projectId: string, parentCompoundId: string, atomType: string, stratum: Stratum) => {
      store.set(`${projectId}::${parentCompoundId}::${atomType}`, { stratum, stale: false });
    }),
    invalidateDescendants: vi.fn(() => 0),
    clear: vi.fn(),
  };
}

// ─── Default Config ─────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: ZoomConfig = {
  minCompoundSize: 6,
  maxStratumDepth: 5,
  maxRetries: 2,
};
