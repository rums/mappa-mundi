import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/interpret/prompt';
import type { DependencyGraph, ModuleNode, ImportEdge } from '../../src/types';
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
  overrides: Partial<DirectoryNode['metrics']> = {},
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
      ...overrides,
    },
  };
}

function buildFourDirProject(): { graph: DependencyGraph; dirTree: DirectoryNode } {
  const modules: ModuleNode[] = [
    makeModule('src/auth/login.ts', [{ name: 'login', kind: 'function', signature: '(): Promise<void>', exported: true }]),
    makeModule('src/auth/session.ts', [{ name: 'Session', kind: 'class', signature: 'class Session', exported: true }]),
    makeModule('src/api/routes.ts', [{ name: 'router', kind: 'variable', signature: 'Router', exported: true }]),
    makeModule('src/api/handler.ts'),
    makeModule('src/db/connection.ts', [{ name: 'connect', kind: 'function', signature: '(): Pool', exported: true }]),
    makeModule('src/db/models.ts', [{ name: 'User', kind: 'interface', signature: 'interface User', exported: true }]),
    makeModule('src/ui/App.tsx'),
    makeModule('src/ui/Dashboard.tsx'),
  ];

  const edges: ImportEdge[] = [
    makeEdge('src/api/handler.ts', 'src/auth/session.ts'),
    makeEdge('src/api/handler.ts', 'src/db/models.ts'),
    makeEdge('src/auth/login.ts', 'src/db/connection.ts'),
    makeEdge('src/ui/App.tsx', 'src/api/routes.ts'),
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

// ─── Behavior 5: Prompt Construction ────────────────────────────────────────

describe('Prompt Construction: content', () => {
  it('should include directory structure in the prompt', () => {
    const { graph, dirTree } = buildFourDirProject();

    const prompt = buildPrompt(graph, dirTree);

    expect(prompt).toContain('auth');
    expect(prompt).toContain('api');
    expect(prompt).toContain('db');
    expect(prompt).toContain('ui');
  });

  it('should include key exported symbols per directory', () => {
    const { graph, dirTree } = buildFourDirProject();

    const prompt = buildPrompt(graph, dirTree);

    expect(prompt).toContain('login');
    expect(prompt).toContain('Session');
    expect(prompt).toContain('connect');
    expect(prompt).toContain('User');
  });

  it('should include cross-directory edges', () => {
    const { graph, dirTree } = buildFourDirProject();

    const prompt = buildPrompt(graph, dirTree);

    // Should mention edges between directories
    expect(prompt).toMatch(/api.*→.*auth|api.*->.*auth|api.*depends.*auth/i);
  });

  it('should include boundary flags when present', () => {
    const { graph, dirTree } = buildFourDirProject();
    // Mark auth as boundary
    dirTree.children[0].isBoundary = true;

    const prompt = buildPrompt(graph, dirTree);

    expect(prompt).toMatch(/boundary|boundary.*auth|auth.*boundary/i);
  });
});

describe('Prompt Construction: determinism', () => {
  it('should produce identical prompt for the same input', () => {
    const { graph, dirTree } = buildFourDirProject();

    const prompt1 = buildPrompt(graph, dirTree);
    const prompt2 = buildPrompt(graph, dirTree);

    expect(prompt1).toBe(prompt2);
  });

  it('should produce identical prompt regardless of input ordering', () => {
    const { graph, dirTree } = buildFourDirProject();

    // Create a copy with reversed node/edge order
    const reversedGraph: DependencyGraph = {
      root: graph.root,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    const reversedDirTree: DirectoryNode = {
      ...dirTree,
      children: [...dirTree.children].reverse(),
    };

    const prompt1 = buildPrompt(graph, dirTree);
    const prompt2 = buildPrompt(reversedGraph, reversedDirTree);

    expect(prompt1).toBe(prompt2);
  });
});

describe('Prompt Construction: truncation', () => {
  it('should respect maxPromptTokens by truncating', () => {
    // Build a large project with many modules and symbols
    const modules: ModuleNode[] = [];
    const edges: ImportEdge[] = [];
    const children: DirectoryNode[] = [];

    for (let i = 0; i < 500; i++) {
      const dir = `pkg${Math.floor(i / 25)}`;
      const id = `src/${dir}/mod${i}.ts`;
      modules.push(makeModule(id, [
        { name: `func${i}`, kind: 'function', signature: `(arg: Type${i}): Result${i}`, exported: true },
        { name: `Class${i}`, kind: 'class', signature: `class Class${i} implements Interface${i}`, exported: true },
        { name: `Type${i}`, kind: 'type', signature: `type Type${i} = { field: string }`, exported: true },
      ]));
      if (i > 0) {
        edges.push(makeEdge(id, `src/pkg${Math.floor((i - 1) / 25)}/mod${i - 1}.ts`));
      }
    }

    for (let d = 0; d < 20; d++) {
      const dirFiles = modules
        .filter(m => m.id.startsWith(`src/pkg${d}/`))
        .map(m => m.id);
      children.push(makeDirNode(`pkg${d}`, `src/pkg${d}`, dirFiles));
    }

    const graph: DependencyGraph = { root: '/project', nodes: modules, edges };
    const dirTree = makeDirNode('src', 'src', [], children);

    // Use a small token limit to force truncation
    const prompt = buildPrompt(graph, dirTree, { maxPromptTokens: 4000 });

    // Rough token estimation: ~4 chars per token
    // The prompt should be within reasonable limits
    const estimatedTokens = prompt.length / 4;
    expect(estimatedTokens).toBeLessThanOrEqual(5000); // some slack for estimation
  });

  it('should preserve directory names when truncating', () => {
    const modules: ModuleNode[] = [];
    const children: DirectoryNode[] = [];

    for (let i = 0; i < 100; i++) {
      const dir = `pkg${Math.floor(i / 5)}`;
      const id = `src/${dir}/mod${i}.ts`;
      modules.push(makeModule(id, [
        { name: `func${i}`, kind: 'function', signature: `(arg: Type${i}): Result${i}`, exported: true },
      ]));
    }

    for (let d = 0; d < 20; d++) {
      const dirFiles = modules
        .filter(m => m.id.startsWith(`src/pkg${d}/`))
        .map(m => m.id);
      children.push(makeDirNode(`pkg${d}`, `src/pkg${d}`, dirFiles));
    }

    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], children);

    const prompt = buildPrompt(graph, dirTree, { maxPromptTokens: 2000 });

    // Directory names should still be present even after truncation
    for (let d = 0; d < 20; d++) {
      expect(prompt).toContain(`pkg${d}`);
    }
  });

  it('should remove symbol details before removing directory names when truncating', () => {
    const modules: ModuleNode[] = [];
    for (let i = 0; i < 100; i++) {
      modules.push(makeModule(`src/pkg0/mod${i}.ts`, [
        { name: `detailedFunction${i}`, kind: 'function', signature: `(a: string, b: number, c: boolean): Promise<Result${i}>`, exported: true },
      ]));
    }
    const dirFiles = modules.map(m => m.id);
    const graph: DependencyGraph = { root: '/project', nodes: modules, edges: [] };
    const dirTree = makeDirNode('src', 'src', [], [
      makeDirNode('pkg0', 'src/pkg0', dirFiles),
    ]);

    const fullPrompt = buildPrompt(graph, dirTree);
    const truncatedPrompt = buildPrompt(graph, dirTree, { maxPromptTokens: 1000 });

    // Full prompt has detailed signatures
    expect(fullPrompt).toContain('detailedFunction0');

    // Truncated prompt should still have directory name
    expect(truncatedPrompt).toContain('pkg0');

    // Truncated prompt should be shorter
    expect(truncatedPrompt.length).toBeLessThan(fullPrompt.length);
  });
});
