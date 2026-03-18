import { describe, it, expect } from 'vitest';
import { buildFallback } from '../../src/interpret/fallback';
import type { DependencyGraph, ModuleNode, ImportEdge } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeModule(id: string): ModuleNode {
  return { id, filePath: `/project/${id}`, exports: [], symbols: [] };
}

function makeEdge(source: string, target: string): ImportEdge {
  return { source, target, imports: [{ name: 'x', kind: 'named' }] };
}

function makeDirNode(
  name: string,
  path: string,
  files: string[] = [],
  children: DirectoryNode[] = [],
): DirectoryNode {
  return {
    name, path, files, children, isBoundary: false,
    metrics: {
      fileCount: files.length, totalLoc: files.length * 50,
      fileCountByExtension: { '.ts': files.length },
      exportedSymbolCount: 0, subtreeFileCount: files.length,
      subtreeLoc: files.length * 50, subtreeExportedSymbolCount: 0,
      inboundEdges: 0, outboundEdges: 0,
    },
  };
}

// ─── Fallback Tests ─────────────────────────────────────────────────────────

describe('Fallback: directory-based grouping', () => {
  it('should produce one region per top-level directory', () => {
    const modules = [
      makeModule('src/auth/login.ts'),
      makeModule('src/auth/session.ts'),
      makeModule('src/api/routes.ts'),
      makeModule('src/db/models.ts'),
    ];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts', 'src/auth/session.ts']),
      makeDirNode('api', 'src/api', ['src/api/routes.ts']),
      makeDirNode('db', 'src/db', ['src/db/models.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    expect(result.regions.length).toBe(3);
  });

  it('should name regions with title-cased directory basename', () => {
    const modules = [
      makeModule('src/auth/login.ts'),
      makeModule('src/api/routes.ts'),
    ];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts']),
      makeDirNode('api', 'src/api', ['src/api/routes.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    const names = result.regions.map(r => r.name).sort();
    expect(names).toEqual(['Api', 'Auth']);
  });

  it('should set moduleCount correctly per region', () => {
    const modules = [
      makeModule('src/auth/login.ts'),
      makeModule('src/auth/session.ts'),
      makeModule('src/auth/middleware.ts'),
      makeModule('src/api/routes.ts'),
    ];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts', 'src/auth/session.ts', 'src/auth/middleware.ts']),
      makeDirNode('api', 'src/api', ['src/api/routes.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    const authRegion = result.regions.find(r => r.name === 'Auth');
    const apiRegion = result.regions.find(r => r.name === 'Api');
    expect(authRegion?.moduleCount).toBe(3);
    expect(apiRegion?.moduleCount).toBe(1);
  });

  it('should conform to SemanticZoomLevel schema', () => {
    const modules = [makeModule('src/lib/utils.ts')];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('lib', 'src/lib', ['src/lib/utils.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('regions');
    expect(result).toHaveProperty('relationships');
    expect(Array.isArray(result.regions)).toBe(true);
    expect(Array.isArray(result.relationships)).toBe(true);
  });

  it('should derive cross-directory relationships in fallback', () => {
    const modules = [
      makeModule('src/auth/login.ts'),
      makeModule('src/api/handler.ts'),
    ];
    const edges = [
      makeEdge('src/api/handler.ts', 'src/auth/login.ts'),
    ];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts']),
      makeDirNode('api', 'src/api', ['src/api/handler.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    expect(result.relationships.length).toBeGreaterThan(0);
    const rel = result.relationships[0];
    expect(rel.edgeCount).toBe(1);
    expect(rel.kind).toBe('depends-on');
  });

  it('should include all modules even if some are not in any top-level directory', () => {
    const modules = [
      makeModule('src/auth/login.ts'),
      makeModule('src/index.ts'), // root-level file, not in a subdirectory
    ];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', ['src/index.ts'], [
      makeDirNode('auth', 'src/auth', ['src/auth/login.ts']),
    ]);

    const result = buildFallback(graph, dirTree);

    const totalModules = result.regions.reduce((sum, r) => sum + r.moduleCount, 0);
    expect(totalModules).toBe(2);
  });
});
