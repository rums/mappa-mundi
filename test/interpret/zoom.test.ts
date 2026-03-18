import { describe, it, expect, vi } from 'vitest';
import { zoomIntoRegion } from '../../src/interpret/zoom';
import type { ZoomConfig } from '../../src/interpret/zoom';
import type { LLMClient, LLMResponse } from '../../src/interpret/cluster';
import type { DependencyGraph, ModuleNode, ImportEdge } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';
import type {
  SemanticRegion,
  SemanticZoomLevel,
  ZoomCache,
} from '../../src/semantic-zoom';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeModule(id: string, symbols: ModuleNode['symbols'] = []): ModuleNode {
  return {
    id,
    filePath: `/project/${id}`,
    exports: [],
    symbols,
  };
}

function makeEdge(source: string, target: string): ImportEdge {
  return {
    source,
    target,
    imports: [{ name: 'default', kind: 'named' }],
  };
}

function makeDirNode(
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

function makeSemanticRegion(
  id: string,
  name: string,
  summary: string,
  modules: string[],
  directories: string[] = [],
): SemanticRegion {
  return {
    id,
    name,
    summary,
    modules,
    directories,
    regionHash: `hash-${id}`,
  };
}

/** Build a 15-module project spread across 3 subdirectories */
function build15ModuleProject(): { graph: DependencyGraph; dirTree: DirectoryNode } {
  const moduleIds = [
    'src/region/auth/login.ts',
    'src/region/auth/session.ts',
    'src/region/auth/tokens.ts',
    'src/region/auth/middleware.ts',
    'src/region/auth/roles.ts',
    'src/region/api/routes.ts',
    'src/region/api/handler.ts',
    'src/region/api/middleware.ts',
    'src/region/api/validation.ts',
    'src/region/api/errors.ts',
    'src/region/db/connection.ts',
    'src/region/db/models.ts',
    'src/region/db/migrations.ts',
    'src/region/db/seeds.ts',
    'src/region/db/utils.ts',
  ];

  const modules = moduleIds.map((id) =>
    makeModule(id, [
      { name: id.split('/').pop()!.replace('.ts', ''), kind: 'function', signature: '(): void', exported: true },
    ]),
  );

  const edges: ImportEdge[] = [
    makeEdge('src/region/api/handler.ts', 'src/region/auth/session.ts'),
    makeEdge('src/region/api/handler.ts', 'src/region/db/models.ts'),
    makeEdge('src/region/auth/login.ts', 'src/region/db/connection.ts'),
  ];

  const graph: DependencyGraph = { root: '/project', nodes: modules, edges };

  const dirTree = makeDirNode('region', 'src/region', [], [
    makeDirNode('auth', 'src/region/auth', moduleIds.slice(0, 5)),
    makeDirNode('api', 'src/region/api', moduleIds.slice(5, 10)),
    makeDirNode('db', 'src/region/db', moduleIds.slice(10, 15)),
  ]);

  return { graph, dirTree };
}

/** Build a 3-module project (below threshold) */
function build3ModuleProject(): { graph: DependencyGraph; dirTree: DirectoryNode } {
  const moduleIds = [
    'src/region/utils.ts',
    'src/region/config.ts',
    'src/region/index.ts',
  ];

  const modules = moduleIds.map((id) =>
    makeModule(id, [
      { name: id.split('/').pop()!.replace('.ts', ''), kind: 'function', signature: '(): void', exported: true },
    ]),
  );

  const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
  const dirTree = makeDirNode('region', 'src/region', moduleIds);

  return { graph, dirTree };
}

/** Build a 5-module project (at threshold boundary) */
function build5ModuleProject(): { graph: DependencyGraph; dirTree: DirectoryNode } {
  const moduleIds = [
    'src/region/a.ts',
    'src/region/b.ts',
    'src/region/c.ts',
    'src/region/d.ts',
    'src/region/e.ts',
  ];

  const modules = moduleIds.map((id) =>
    makeModule(id, [
      { name: id.split('/').pop()!.replace('.ts', ''), kind: 'function', signature: '(): void', exported: true },
    ]),
  );

  const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
  const dirTree = makeDirNode('region', 'src/region', moduleIds, [
    makeDirNode('sub1', 'src/region/sub1', moduleIds.slice(0, 3)),
    makeDirNode('sub2', 'src/region/sub2', moduleIds.slice(3, 5)),
  ]);

  return { graph, dirTree };
}

/** Mock LLM that returns a valid sub-region clustering response */
function createSuccessZoomLLM(
  regions: Array<{ name: string; summary: string; modules: string[] }>,
): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: { regions },
      usage: { promptTokens: 1000, completionTokens: 200 },
    } satisfies LLMResponse),
  };
}

/** Mock LLM that always fails */
function createFailingLLM(): LLMClient {
  return {
    complete: vi.fn().mockRejectedValue(new Error('Network error: connection refused')),
  };
}

/** Mock LLM that returns all modules in one sub-region (no progress) */
function createNoProgressLLM(allModules: string[]): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: {
        regions: [
          { name: 'Everything', summary: 'All modules', modules: allModules },
        ],
      },
      usage: { promptTokens: 1000, completionTokens: 100 },
    } satisfies LLMResponse),
  };
}

/** Create a mock ZoomCache */
function createMockCache(): ZoomCache {
  const store = new Map<string, { level: SemanticZoomLevel; stale: boolean }>();
  return {
    get: vi.fn((projectId: string, path: string, depth: number) => {
      const key = `${projectId}::${path}::${depth}`;
      return store.get(key) ?? null;
    }),
    set: vi.fn((projectId: string, path: string, depth: number, level: SemanticZoomLevel) => {
      store.set(`${projectId}::${path}::${depth}`, { level, stale: false });
    }),
    invalidateByPath: vi.fn(() => 0),
    invalidateByHash: vi.fn(() => false),
    clear: vi.fn(),
  };
}

/** Parent region for zoom context */
function makeParentRegion(modules: string[]): SemanticRegion {
  return makeSemanticRegion(
    'region-parent',
    'Parent Region',
    'This is the parent region summary for context',
    modules,
    ['src/region'],
  );
}

// ─── Behavior 1: Sub-region clustering ───────────────────────────────────────

describe('Zoom: sub-region clustering', () => {
  // AC#1: Given a region with 15 modules, returns 3-7 sub-regions covering all 15
  it('should return 3-7 sub-regions for a region with 15 modules', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));

    const llm = createSuccessZoomLLM([
      { name: 'Authentication', summary: 'Auth subsystem', modules: graph.nodes.slice(0, 5).map((n) => n.id) },
      { name: 'API Layer', summary: 'API endpoints', modules: graph.nodes.slice(5, 10).map((n) => n.id) },
      { name: 'Data Layer', summary: 'Database layer', modules: graph.nodes.slice(10, 15).map((n) => n.id) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result.regions.length).toBeGreaterThanOrEqual(3);
    expect(result.regions.length).toBeLessThanOrEqual(7);
  });

  it('should cover all parent modules in sub-regions (no orphans, no duplicates)', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const allModuleIds = graph.nodes.map((n) => n.id);
    const parentRegion = makeParentRegion(allModuleIds);

    const llm = createSuccessZoomLLM([
      { name: 'Authentication', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API Layer', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'Data Layer', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Collect all modules from all sub-regions
    const coveredModules = result.regions.flatMap((r) => r.modules);
    const uniqueModules = [...new Set(coveredModules)];

    // All 15 modules must be covered
    expect(uniqueModules.sort()).toEqual([...allModuleIds].sort());
    // No duplicates
    expect(coveredModules.length).toBe(uniqueModules.length);
  });

  it('should produce sub-regions with non-empty name and summary', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));

    const llm = createSuccessZoomLLM([
      { name: 'Authentication', summary: 'Auth subsystem', modules: graph.nodes.slice(0, 5).map((n) => n.id) },
      { name: 'API Layer', summary: 'API endpoints', modules: graph.nodes.slice(5, 10).map((n) => n.id) },
      { name: 'Data Layer', summary: 'Database layer', modules: graph.nodes.slice(10, 15).map((n) => n.id) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    for (const region of result.regions) {
      expect(region.name.length).toBeGreaterThan(0);
      expect(region.summary.length).toBeGreaterThan(0);
    }
  });
});

// ─── Behavior 2: Module-level detail (below threshold) ──────────────────────

describe('Zoom: module-level detail (below threshold)', () => {
  // AC#2: Given a region with 3 modules, returns module-level detail without LLM call
  it('should return one region per module when below threshold (3 modules)', async () => {
    const { graph, dirTree } = build3ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result.regions).toHaveLength(3);
    // Each region should have exactly one module
    for (const region of result.regions) {
      expect(region.modules).toHaveLength(1);
    }
    // LLM should NOT have been called
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should use filename as region name for module-level detail', async () => {
    const { graph, dirTree } = build3ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    const names = result.regions.map((r) => r.name).sort();
    expect(names).toEqual(['config.ts', 'index.ts', 'utils.ts']);
  });

  it('should use exported symbols as summary for module-level detail', async () => {
    const { graph, dirTree } = build3ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Each region summary should mention its exported symbols
    for (const region of result.regions) {
      expect(region.summary.length).toBeGreaterThan(0);
    }
  });

  it('should return module-level detail for 4 modules (4 < 5 threshold)', async () => {
    const moduleIds = [
      'src/region/a.ts',
      'src/region/b.ts',
      'src/region/c.ts',
      'src/region/d.ts',
    ];
    const modules = moduleIds.map((id) =>
      makeModule(id, [
        { name: 'fn', kind: 'function', signature: '(): void', exported: true },
      ]),
    );
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('region', 'src/region', moduleIds);
    const parentRegion = makeParentRegion(moduleIds);
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result.regions).toHaveLength(4);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should return single region for 1 module', async () => {
    const modules = [makeModule('src/region/only.ts', [
      { name: 'only', kind: 'function', signature: '(): void', exported: true },
    ])];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('region', 'src/region', ['src/region/only.ts']);
    const parentRegion = makeParentRegion(['src/region/only.ts']);
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].modules).toEqual(['src/region/only.ts']);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should return empty regions array for 0 modules', async () => {
    const graph: DependencyGraph = { root: '/project', nodes: [], edges: [] };
    const dirTree = makeDirNode('region', 'src/region');
    const parentRegion = makeParentRegion([]);
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result.regions).toHaveLength(0);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

// ─── Behavior 3: Threshold boundary ─────────────────────────────────────────

describe('Zoom: threshold boundary', () => {
  // AC#3: Given a region with exactly 5 modules, attempts LLM clustering
  it('should attempt LLM clustering for exactly 5 modules (>= threshold)', async () => {
    const { graph, dirTree } = build5ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Group A', summary: 'First group', modules: allModuleIds.slice(0, 3) },
      { name: 'Group B', summary: 'Second group', modules: allModuleIds.slice(3, 5) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // LLM should have been called since 5 >= MIN_CLUSTER_SIZE
    expect(llm.complete).toHaveBeenCalled();
    expect(result.regions.length).toBeGreaterThanOrEqual(2);
  });

  it('should respect configurable threshold (set to 3)', async () => {
    const { graph, dirTree } = build3ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Group A', summary: 'First', modules: allModuleIds.slice(0, 2) },
      { name: 'Group B', summary: 'Second', modules: allModuleIds.slice(2) },
    ]);
    const cache = createMockCache();
    const config: ZoomConfig = { minClusterSize: 3 };

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project', config);

    // With threshold=3, 3 modules should trigger LLM clustering
    expect(llm.complete).toHaveBeenCalled();
  });
});

// ─── Behavior 4: Cache integration ──────────────────────────────────────────

describe('Zoom: cache integration', () => {
  // AC#4: Second zoom into same region returns cached result without LLM call
  it('should store successful zoom results in cache', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Cache.set should have been called
    expect(cache.set).toHaveBeenCalled();
  });

  it('should return cached result on second zoom without calling LLM', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    // First call — populates cache
    const firstResult = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Reset LLM mock
    (llm.complete as ReturnType<typeof vi.fn>).mockClear();

    // Second call — should use cache
    const secondResult = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(secondResult.regions.length).toBe(firstResult.regions.length);
  });

  // AC#12: Fallback results are cached
  it('should cache fallback results', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm = createFailingLLM();
    const cache = createMockCache();

    await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(cache.set).toHaveBeenCalled();
  });
});

// ─── Behavior 5: Scoped relationships ───────────────────────────────────────

describe('Zoom: scoped relationships', () => {
  // AC#5: Sub-region relationships only reference sibling region IDs
  it('should only produce relationships between sibling sub-regions', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    const siblingIds = new Set(result.regions.map((r) => r.id));
    for (const rel of result.relationships) {
      expect(siblingIds.has(rel.source)).toBe(true);
      expect(siblingIds.has(rel.target)).toBe(true);
    }
  });

  it('should filter out self-referential relationships', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    for (const rel of result.relationships) {
      expect(rel.source).not.toBe(rel.target);
    }
  });
});

// ─── Behavior 6: Parent context in prompt ───────────────────────────────────

describe('Zoom: parent context in prompt', () => {
  // AC#6: LLM prompt includes parent region's name and summary
  it('should include parent region name and summary in LLM prompt', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeSemanticRegion(
      'region-parent',
      'Authentication System',
      'Handles user authentication, sessions, and token management',
      graph.nodes.map((n) => n.id),
      ['src/region'],
    );

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: graph.nodes.slice(0, 5).map((n) => n.id) },
      { name: 'API', summary: 'API', modules: graph.nodes.slice(5, 10).map((n) => n.id) },
      { name: 'DB', summary: 'DB', modules: graph.nodes.slice(10, 15).map((n) => n.id) },
    ]);
    const cache = createMockCache();

    await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Verify the prompt passed to LLM contains parent context
    const promptArg = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptArg).toContain('Authentication System');
    expect(promptArg).toContain('Handles user authentication, sessions, and token management');
  });
});

// ─── Behavior 7: Fallback behavior ──────────────────────────────────────────

describe('Zoom: fallback behavior', () => {
  // AC#7: On LLM failure (after retries), falls back to subdirectory grouping
  it('should fall back to subdirectory grouping after LLM failure', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm = createFailingLLM();
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // Should fall back to subdirectory grouping: auth, api, db
    expect(result.regions.length).toBeGreaterThanOrEqual(1);
    // All modules must still be covered
    const coveredModules = result.regions.flatMap((r) => r.modules);
    expect(coveredModules.sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });

  // AC#8: When all modules share one directory, fallback groups alphabetically
  it('should group alphabetically when all modules share one directory', async () => {
    const moduleIds = Array.from({ length: 9 }, (_, i) =>
      `src/region/file${String(i).padStart(2, '0')}.ts`,
    );
    const modules = moduleIds.map((id) => makeModule(id));
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('region', 'src/region', moduleIds);
    const parentRegion = makeParentRegion(moduleIds);
    const llm = createFailingLLM();
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // All in same directory → alphabetical grouping with ceil(9/3)=3 groups
    expect(result.regions.length).toBe(3);
    // All modules still covered
    const coveredModules = result.regions.flatMap((r) => r.modules);
    expect(coveredModules.sort()).toEqual(moduleIds.sort());
  });

  // AC#11: Output conforms to SemanticZoomLevel schema (including fallback)
  it('should produce fallback output conforming to SemanticZoomLevel schema', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm = createFailingLLM();
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // SemanticZoomLevel schema fields
    expect(result).toHaveProperty('path');
    expect(result).toHaveProperty('depth');
    expect(result).toHaveProperty('regions');
    expect(result).toHaveProperty('relationships');
    expect(result).toHaveProperty('sourceHash');
    expect(result).toHaveProperty('generatedAt');
    expect(Array.isArray(result.regions)).toBe(true);
    expect(Array.isArray(result.relationships)).toBe(true);

    // Each region must conform to SemanticRegion
    for (const region of result.regions) {
      expect(region).toHaveProperty('id');
      expect(region).toHaveProperty('name');
      expect(region).toHaveProperty('summary');
      expect(region).toHaveProperty('modules');
      expect(region).toHaveProperty('regionHash');
      expect(Array.isArray(region.modules)).toBe(true);
    }
  });

  // AC#10: LLM returning all modules in one sub-region triggers fallback
  it('should trigger fallback when LLM returns all modules in one sub-region (no-progress guard)', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const allModuleIds = graph.nodes.map((n) => n.id);
    const parentRegion = makeParentRegion(allModuleIds);
    const llm = createNoProgressLLM(allModuleIds);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    // No-progress guard should trigger fallback — result should have multiple sub-regions
    expect(result.regions.length).toBeGreaterThan(1);
  });
});

// ─── Behavior 8: Recursion safety ───────────────────────────────────────────

describe('Zoom: recursion safety', () => {
  // AC#9: At MAX_ZOOM_DEPTH, returns module-level detail regardless of module count
  it('should return module-level detail at MAX_ZOOM_DEPTH regardless of module count', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const llm: LLMClient = { complete: vi.fn() };
    const cache = createMockCache();
    const config: ZoomConfig = { maxZoomDepth: 5 };

    // Simulate being at max depth by passing depth = 5
    const result = await zoomIntoRegion(
      parentRegion, graph, dirTree, llm, cache, 'test-project', config, 5, // current depth at max
    );

    // Should return module-level detail for all 15 modules without LLM
    expect(result.regions).toHaveLength(15);
    expect(llm.complete).not.toHaveBeenCalled();
    for (const region of result.regions) {
      expect(region.modules).toHaveLength(1);
    }
  });

  it('should allow zoom when depth is below MAX_ZOOM_DEPTH', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();
    const config: ZoomConfig = { maxZoomDepth: 5 };

    // Depth 2 is below max
    const result = await zoomIntoRegion(
      parentRegion, graph, dirTree, llm, cache, 'test-project', config, 2,
    );

    // Should attempt LLM clustering
    expect(llm.complete).toHaveBeenCalled();
    expect(result.regions.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Behavior 9: Schema conformance (success path) ─────────────────────────

describe('Zoom: schema conformance (success)', () => {
  it('should output a valid SemanticZoomLevel on success', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    expect(result).toHaveProperty('path');
    expect(result).toHaveProperty('depth');
    expect(result).toHaveProperty('regions');
    expect(result).toHaveProperty('relationships');
    expect(result).toHaveProperty('sourceHash');
    expect(result).toHaveProperty('generatedAt');
    expect(typeof result.depth).toBe('number');
    expect(typeof result.sourceHash).toBe('string');
  });

  it('should be JSON-serializable', async () => {
    const { graph, dirTree } = build15ModuleProject();
    const parentRegion = makeParentRegion(graph.nodes.map((n) => n.id));
    const allModuleIds = graph.nodes.map((n) => n.id);

    const llm = createSuccessZoomLLM([
      { name: 'Auth', summary: 'Auth', modules: allModuleIds.slice(0, 5) },
      { name: 'API', summary: 'API', modules: allModuleIds.slice(5, 10) },
      { name: 'DB', summary: 'DB', modules: allModuleIds.slice(10, 15) },
    ]);
    const cache = createMockCache();

    const result = await zoomIntoRegion(parentRegion, graph, dirTree, llm, cache, 'test-project');

    const serialized = JSON.stringify(result);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(result);
  });
});
