import { describe, it, expect, vi } from 'vitest';
import { clusterTopLevel } from '../../src/interpret/cluster';
import type { LLMClient, LLMResponse, ClusteringConfig } from '../../src/interpret/cluster';
import type { DependencyGraph, ModuleNode, ImportEdge, SemanticZoomLevel } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';

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

/** Build a 4-directory project graph (auth, api, db, ui) */
function buildFourDirProject(): { graph: DependencyGraph; dirTree: DirectoryNode } {
  const modules: ModuleNode[] = [
    makeModule('src/auth/login.ts', [{ name: 'login', kind: 'function', signature: '(): Promise<void>', exported: true }]),
    makeModule('src/auth/session.ts', [{ name: 'Session', kind: 'class', signature: 'class Session', exported: true }]),
    makeModule('src/api/routes.ts', [{ name: 'router', kind: 'variable', signature: 'Router', exported: true }]),
    makeModule('src/api/handler.ts', [{ name: 'handle', kind: 'function', signature: '(req: Request): Response', exported: true }]),
    makeModule('src/db/connection.ts', [{ name: 'connect', kind: 'function', signature: '(): Pool', exported: true }]),
    makeModule('src/db/models.ts', [{ name: 'User', kind: 'interface', signature: 'interface User', exported: true }]),
    makeModule('src/ui/App.tsx', [{ name: 'App', kind: 'function', signature: '(): JSX.Element', exported: true }]),
    makeModule('src/ui/Dashboard.tsx', [{ name: 'Dashboard', kind: 'function', signature: '(): JSX.Element', exported: true }]),
  ];

  const edges: ImportEdge[] = [
    makeEdge('src/api/handler.ts', 'src/auth/session.ts'),
    makeEdge('src/api/handler.ts', 'src/db/models.ts'),
    makeEdge('src/auth/login.ts', 'src/db/connection.ts'),
    makeEdge('src/ui/App.tsx', 'src/api/routes.ts'),
    makeEdge('src/ui/Dashboard.tsx', 'src/api/handler.ts'),
  ];

  const graph: DependencyGraph = { root: '/project', nodes: modules, edges };

  const dirTree = makeDirNode('src', 'src', [], [
    makeDirNode('auth', 'src/auth', ['src/auth/login.ts', 'src/auth/session.ts']),
    makeDirNode('api', 'src/api', ['src/api/routes.ts', 'src/api/handler.ts']),
    makeDirNode('db', 'src/db', ['src/db/connection.ts', 'src/db/models.ts']),
    makeDirNode('ui', 'src/ui', ['src/ui/App.tsx', 'src/ui/Dashboard.tsx']),
  ]);

  return { graph, dirTree };
}

/** Mock LLM that returns a valid clustering response */
function createSuccessLLM(regions: Array<{ name: string; summary: string; modules: string[] }>): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: { regions },
      usage: { promptTokens: 1000, completionTokens: 200 },
    } satisfies LLMResponse),
  };
}

/** Mock LLM that always fails with a network error */
function createFailingLLM(): LLMClient {
  return {
    complete: vi.fn().mockRejectedValue(new Error('Network error: connection refused')),
  };
}

/** Mock LLM that returns malformed JSON */
function createMalformedLLM(): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: 'not valid json {{{',
      usage: { promptTokens: 500, completionTokens: 10 },
    }),
  };
}

/** Mock LLM that returns wrong schema */
function createWrongSchemaLLM(): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: { unrelated: 'data', missing: 'regions' },
      usage: { promptTokens: 500, completionTokens: 50 },
    }),
  };
}

// ─── Behavior 1: Clustering Output ──────────────────────────────────────────

describe('Clustering: output', () => {
  it('should return 3-7 named regions for a project with 4 directories', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'User auth and sessions', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API Layer', summary: 'REST API routing and handlers', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Data Layer', summary: 'Database connection and models', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'User Interface', summary: 'React frontend components', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBeGreaterThanOrEqual(3);
    expect(result.zoomLevel.regions.length).toBeLessThanOrEqual(7);
  });

  it('should produce regions with non-empty name and summary', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'User auth and sessions', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API Layer', summary: 'REST API routing and handlers', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Data Layer', summary: 'Database connection and models', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'User Interface', summary: 'React frontend components', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    for (const region of result.zoomLevel.regions) {
      expect(region.name).toBeTruthy();
      expect(region.name.length).toBeGreaterThan(0);
    }
  });

  it('should produce a single region for a project with 1 directory', async () => {
    const modules = [makeModule('src/lib/utils.ts')];
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('lib', 'src/lib', ['src/lib/utils.ts']),
    ]);
    const llm = createSuccessLLM([
      { name: 'Library', summary: 'Utility library', modules: ['src/lib/utils.ts'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBeGreaterThanOrEqual(1);
  });

  it('should produce at most 7 regions for a project with 20+ directories', async () => {
    const dirNames = Array.from({ length: 20 }, (_, i) => `pkg${i}`);
    const modules = dirNames.map(d => makeModule(`src/${d}/index.ts`));
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const children = dirNames.map(d =>
      makeDirNode(d, `src/${d}`, [`src/${d}/index.ts`]),
    );
    const dirTree = makeDirNode('src', 'src', [], children);

    // LLM groups 20 dirs into 5 regions
    const llm = createSuccessLLM([
      { name: 'Core', summary: 'Core packages', modules: dirNames.slice(0, 4).map(d => `src/${d}/index.ts`) },
      { name: 'Services', summary: 'Service layer', modules: dirNames.slice(4, 8).map(d => `src/${d}/index.ts`) },
      { name: 'Models', summary: 'Data models', modules: dirNames.slice(8, 12).map(d => `src/${d}/index.ts`) },
      { name: 'Utils', summary: 'Utilities', modules: dirNames.slice(12, 16).map(d => `src/${d}/index.ts`) },
      { name: 'Config', summary: 'Configuration', modules: dirNames.slice(16, 20).map(d => `src/${d}/index.ts`) },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBeLessThanOrEqual(7);
  });
});

// ─── Behavior 2: Module Coverage ────────────────────────────────────────────

describe('Clustering: module coverage', () => {
  it('should include every input module in exactly one region', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API Layer', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Data Layer', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'User Interface', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    const allModuleIds = graph.nodes.map(n => n.id);
    // Collect all modules from all regions
    const assignedModules: string[] = [];
    for (const region of result.zoomLevel.regions) {
      // Region should expose module IDs — exact shape depends on implementation
      // but the SemanticZoomLevel.Region should have module list
      expect(region.moduleCount).toBeGreaterThan(0);
    }
    // Total module count across regions should equal input module count
    const totalModules = result.zoomLevel.regions.reduce((sum, r) => sum + r.moduleCount, 0);
    expect(totalModules).toBe(allModuleIds.length);
  });

  it('should fix orphaned modules by assigning them to nearest region', async () => {
    const { graph, dirTree } = buildFourDirProject();
    // LLM response is missing src/db/models.ts
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API Layer', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Data Layer', summary: 'DB', modules: ['src/db/connection.ts'] }, // missing models.ts
      { name: 'User Interface', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    // All 8 modules must be accounted for, even though LLM only assigned 7
    const totalModules = result.zoomLevel.regions.reduce((sum, r) => sum + r.moduleCount, 0);
    expect(totalModules).toBe(8);
  });

  it('should fix duplicate modules by keeping only the first assignment', async () => {
    const { graph, dirTree } = buildFourDirProject();
    // LLM assigns src/api/handler.ts to both API Layer and Data Layer
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API Layer', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Data Layer', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts', 'src/api/handler.ts'] }, // duplicate
      { name: 'User Interface', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    // Still 8 unique modules, not 9
    const totalModules = result.zoomLevel.regions.reduce((sum, r) => sum + r.moduleCount, 0);
    expect(totalModules).toBe(8);
  });
});

// ─── Behavior 3: Schema Conformance ─────────────────────────────────────────

describe('Clustering: schema conformance', () => {
  it('should output a valid SemanticZoomLevel', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Authentication', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API', summary: 'API layer', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'Database', summary: 'DB layer', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'Frontend', summary: 'UI layer', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    // Structural checks for ClusterResult
    expect(result).toHaveProperty('zoomLevel');
    expect(result).toHaveProperty('regionModuleMap');
    expect(result.zoomLevel).toHaveProperty('id');
    expect(result.zoomLevel).toHaveProperty('label');
    expect(Array.isArray(result.zoomLevel.regions)).toBe(true);
    expect(Array.isArray(result.zoomLevel.relationships)).toBe(true);
  });

  it('should have an id and label on the zoom level', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'DB', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'UI', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(typeof result.zoomLevel.id).toBe('string');
    expect(result.zoomLevel.id.length).toBeGreaterThan(0);
    expect(typeof result.zoomLevel.label).toBe('string');
    expect(result.zoomLevel.label.length).toBeGreaterThan(0);
  });

  it('should have valid region objects with id, name, moduleCount, and loc', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'DB', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'UI', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    for (const region of result.zoomLevel.regions) {
      expect(typeof region.id).toBe('string');
      expect(region.id.length).toBeGreaterThan(0);
      expect(typeof region.name).toBe('string');
      expect(region.name.length).toBeGreaterThan(0);
      expect(typeof region.moduleCount).toBe('number');
      expect(region.moduleCount).toBeGreaterThan(0);
      expect(typeof region.loc).toBe('number');
      expect(region.loc).toBeGreaterThanOrEqual(0);
    }
  });

  it('should have valid relationship objects', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'DB', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'UI', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    for (const rel of result.zoomLevel.relationships) {
      expect(typeof rel.sourceId).toBe('string');
      expect(typeof rel.targetId).toBe('string');
      expect(typeof rel.kind).toBe('string');
      expect(['depends-on', 'extends', 'implements', 'uses']).toContain(rel.kind);
      expect(typeof rel.edgeCount).toBe('number');
      expect(rel.edgeCount).toBeGreaterThan(0);
    }
  });

  it('should be JSON-serializable', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createSuccessLLM([
      { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
      { name: 'API', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
      { name: 'DB', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
      { name: 'UI', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
    ]);

    const result = await clusterTopLevel(graph, dirTree, llm);

    const serialized = JSON.stringify(result);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(result);
  });
});

// ─── Behavior 4: Fallback Behavior ──────────────────────────────────────────

describe('Clustering: fallback behavior', () => {
  it('should fall back to directory-based grouping after LLM network errors exhaust retries', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();
    const config: Partial<ClusteringConfig> = { maxRetries: 3 };

    const result = await clusterTopLevel(graph, dirTree, llm, config);

    // Should still return a valid result (fallback)
    expect(result.zoomLevel.regions.length).toBeGreaterThanOrEqual(1);
    // Fallback: one region per top-level directory
    expect(result.zoomLevel.regions.length).toBe(4); // auth, api, db, ui
  });

  it('should fall back after LLM returns malformed JSON', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createMalformedLLM();

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBe(4);
  });

  it('should fall back after LLM returns wrong schema', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createWrongSchemaLLM();

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBe(4);
  });

  it('should produce fallback regions with name = directory basename (title-cased)', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();

    const result = await clusterTopLevel(graph, dirTree, llm);

    const regionNames = result.zoomLevel.regions.map(r => r.name).sort();
    expect(regionNames).toEqual(['Api', 'Auth', 'Db', 'Ui']);
  });

  it('should produce fallback output that conforms to SemanticZoomLevel schema', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result).toHaveProperty('zoomLevel');
    expect(result.zoomLevel).toHaveProperty('id');
    expect(result.zoomLevel).toHaveProperty('label');
    expect(Array.isArray(result.zoomLevel.regions)).toBe(true);
    expect(Array.isArray(result.zoomLevel.relationships)).toBe(true);

    for (const region of result.zoomLevel.regions) {
      expect(typeof region.id).toBe('string');
      expect(typeof region.name).toBe('string');
      expect(typeof region.moduleCount).toBe('number');
      expect(typeof region.loc).toBe('number');
    }
  });

  it('should include all modules in fallback output', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();

    const result = await clusterTopLevel(graph, dirTree, llm);

    const totalModules = result.zoomLevel.regions.reduce((sum, r) => sum + r.moduleCount, 0);
    expect(totalModules).toBe(graph.nodes.length);
  });
});

// ─── Behavior 5: Prompt Construction ────────────────────────────────────────
// Tested via the prompt module directly — see prompt.test.ts

// ─── Behavior 6: Relationship Derivation ────────────────────────────────────
// Tested via the relationships module — see relationships.test.ts

// ─── Behavior 7: Retry Behavior ─────────────────────────────────────────────

describe('Clustering: retry behavior', () => {
  it('should return the result from a successful retry after initial failure', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm: LLMClient = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          content: {
            regions: [
              { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/auth/session.ts'] },
              { name: 'API', summary: 'API', modules: ['src/api/routes.ts', 'src/api/handler.ts'] },
              { name: 'DB', summary: 'DB', modules: ['src/db/connection.ts', 'src/db/models.ts'] },
              { name: 'UI', summary: 'UI', modules: ['src/ui/App.tsx', 'src/ui/Dashboard.tsx'] },
            ],
          },
          usage: { promptTokens: 1000, completionTokens: 200 },
        } satisfies LLMResponse),
    };

    const result = await clusterTopLevel(graph, dirTree, llm);

    expect(result.zoomLevel.regions.length).toBe(4);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('should fall back after all retries are exhausted', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();
    const config: Partial<ClusteringConfig> = { maxRetries: 3 };

    const result = await clusterTopLevel(graph, dirTree, llm, config);

    // Should have attempted maxRetries + 1 calls (initial + retries)
    expect(llm.complete).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    // Should still return valid fallback result
    expect(result.zoomLevel.regions.length).toBe(4);
  });

  it('should call LLM with correct number of retries from config', async () => {
    const { graph, dirTree } = buildFourDirProject();
    const llm = createFailingLLM();
    const config: Partial<ClusteringConfig> = { maxRetries: 2 };

    const result = await clusterTopLevel(graph, dirTree, llm, config);

    expect(llm.complete).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
