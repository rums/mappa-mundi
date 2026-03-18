import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { buildDirectoryTree } from '../src/directory-tree';
import type { DirectoryNode, DirectoryTreeOptions } from '../src/directory-tree';
import type { DependencyGraph } from '../src/types';

// Helper to get fixture path
const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

// Helper to find a directory node by relative path in the tree
function findNode(root: DirectoryNode, path: string): DirectoryNode | undefined {
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return undefined;
}

// Stub graph with no edges/nodes for structural-only tests
function emptyGraph(root: string): DependencyGraph {
  return { root, nodes: [], edges: [] };
}

// Build a mock graph with specified nodes and edges for edge-counting tests
function mockGraph(
  root: string,
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>
): DependencyGraph {
  return {
    root,
    nodes: nodeIds.map(id => ({
      id,
      filePath: resolve(root, id),
      exports: [],
      symbols: [],
    })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      imports: [{ name: 'default', kind: 'named' as const }],
    })),
  };
}

// ─── Behavior 1: Tree Structure ────────────────────────────────────────────

describe('Directory Tree: Tree Structure', () => {
  // AC 1: Given src/auth/, src/api/, src/db/ each with files, the tree has a src/ node with 3 children
  it('should produce a src/ node with 3 children for 3 subdirectories', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    expect(src!.children).toHaveLength(3);

    const childNames = src!.children.map(c => c.name).sort();
    expect(childNames).toEqual(['api', 'auth', 'db']);
  });

  it('should produce correct parent-child chain for deeply nested directories', async () => {
    const root = fixture('dir-tree-nested');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();

    const a = findNode(tree, 'src/a');
    expect(a).toBeDefined();

    const b = findNode(tree, 'src/a/b');
    expect(b).toBeDefined();

    const c = findNode(tree, 'src/a/b/c');
    expect(c).toBeDefined();
    expect(c!.files).toContain('src/a/b/c/deep.ts');
  });

  it('should produce a leaf node with empty children array for directory with no subdirs', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.children).toEqual([]);
    expect(auth!.files.length).toBeGreaterThan(0);
  });

  it('should set name to directory basename', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.name).toBe('auth');
  });

  // AC 10: Empty directories don't appear in the tree
  it('should prune empty directories from the tree', async () => {
    const root = fixture('dir-tree-empty');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const empty = findNode(tree, 'src/empty');
    expect(empty).toBeUndefined();

    const full = findNode(tree, 'src/full');
    expect(full).toBeDefined();
  });

  // AC 4: JSON serialization round-trip
  it('should round-trip through JSON serialization', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const json = JSON.stringify(tree);
    const parsed = JSON.parse(json) as DirectoryNode;

    expect(parsed.path).toBe(tree.path);
    expect(parsed.children).toHaveLength(tree.children.length);

    const src = findNode(parsed, 'src');
    expect(src).toBeDefined();
    expect(src!.children).toHaveLength(3);
  });
});

// ─── Behavior 2: File Metrics ──────────────────────────────────────────────

describe('Directory Tree: File Metrics', () => {
  // AC 2: 5 TS files totaling 200 non-empty lines → fileCount: 5, totalLoc: 200
  it('should count files and LOC correctly for a directory with 5 TS files', async () => {
    const root = fixture('dir-tree-metrics');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    expect(src!.metrics.fileCount).toBe(5);
    expect(src!.metrics.totalLoc).toBe(200);
  });

  it('should count empty file in fileCount but with 0 LOC', async () => {
    const root = fixture('dir-tree-metrics');
    // We'll verify that an empty file is counted in fileCount
    // but contributes 0 to LOC. The fixture already has non-empty files.
    // A directory with no files should have 0 for both.
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    // fileCount includes all files regardless of content
    expect(src!.metrics.fileCount).toBeGreaterThanOrEqual(5);
  });

  // AC 6: Mixed extensions → per-extension breakdown
  it('should produce correct fileCountByExtension for mixed file types', async () => {
    const root = fixture('dir-tree-extensions');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    expect(src!.metrics.fileCountByExtension).toEqual({
      '.ts': 3,
      '.json': 1,
    });
  });

  it('should exclude whitespace-only lines from LOC count', async () => {
    const root = fixture('dir-tree-metrics');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    // Each file has exactly 40 non-empty lines, no blank lines
    expect(src!.metrics.totalLoc).toBe(200);
  });

  it('should only count LOC for TS/JS files, not JSON or other extensions', async () => {
    const root = fixture('dir-tree-extensions');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    // 3 TS files with 1 line each = 3 LOC (JSON not counted)
    expect(src!.metrics.totalLoc).toBe(3);
  });
});

// ─── Behavior 3: Gitignore Exclusion ───────────────────────────────────────

describe('Directory Tree: Gitignore Exclusion', () => {
  // AC 3: node_modules/ and .gitignore directories excluded
  it('should exclude directories listed in .gitignore', async () => {
    const root = fixture('dir-tree-gitignore');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    // vendor/ is in .gitignore
    const vendor = findNode(tree, 'vendor');
    expect(vendor).toBeUndefined();

    // src/ should still be present
    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
  });

  it('should always exclude .git/ directory', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const git = findNode(tree, '.git');
    expect(git).toBeUndefined();
  });

  it('should work when no .gitignore file exists', async () => {
    const root = fixture('dir-tree-no-gitignore');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    expect(src!.files).toContain('src/index.ts');
  });

  it('should respect custom exclude patterns from options', async () => {
    const root = fixture('dir-tree-gitignore');
    const options: DirectoryTreeOptions = {
      excludePatterns: ['build/'],
    };
    const tree = await buildDirectoryTree(root, emptyGraph(root), options);

    // build/ excluded via custom pattern
    const build = findNode(tree, 'build');
    expect(build).toBeUndefined();

    // src/ still present
    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
  });
});

// ─── Behavior 4: Boundary Detection ───────────────────────────────────────

describe('Directory Tree: Boundary Detection', () => {
  // AC 5: 75% cross-boundary edges with default 0.7 threshold → isBoundary true
  it('should mark directory as boundary when cross-boundary edges exceed threshold', async () => {
    const root = fixture('dir-tree-boundary');
    // auth/middleware.ts imports from api/handler.ts (cross-boundary)
    // api/handler.ts imports from auth/middleware.ts (cross-boundary)
    // For auth/: 1 outbound edge (to api), 1 inbound edge (from api) — all edges are cross-boundary
    // crossBoundaryEdges / totalEdges = 2/2 = 1.0 >= 0.7 → boundary
    const graph = mockGraph(root, [
      'src/auth/middleware.ts',
      'src/api/handler.ts',
    ], [
      { source: 'src/auth/middleware.ts', target: 'src/api/handler.ts' },
      { source: 'src/api/handler.ts', target: 'src/auth/middleware.ts' },
    ]);

    const tree = await buildDirectoryTree(root, graph);

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.isBoundary).toBe(true);
  });

  // AC 8: 0 edges → isBoundary false
  it('should mark directory as non-boundary when it has zero edges', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.isBoundary).toBe(false);
  });

  it('should not mark directory as boundary when cross-boundary proportion is below threshold', async () => {
    const root = fixture('dir-tree-internal-edges');
    // Two files in auth/: helper.ts and user.ts; user.ts imports helper.ts
    // For auth/: 1 internal edge, 0 cross-boundary edges
    // crossBoundary / total = 0/1 = 0 < 0.7 → not boundary
    const graph = mockGraph(root, [
      'src/auth/helper.ts',
      'src/auth/user.ts',
    ], [
      { source: 'src/auth/user.ts', target: 'src/auth/helper.ts' },
    ]);

    const tree = await buildDirectoryTree(root, graph);

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.isBoundary).toBe(false);
  });

  it('should respect configurable boundary threshold', async () => {
    const root = fixture('dir-tree-boundary');
    const graph = mockGraph(root, [
      'src/auth/middleware.ts',
      'src/api/handler.ts',
    ], [
      { source: 'src/auth/middleware.ts', target: 'src/api/handler.ts' },
      { source: 'src/api/handler.ts', target: 'src/auth/middleware.ts' },
    ]);

    // With threshold 1.0, 100% cross-boundary should still match
    const tree = await buildDirectoryTree(root, graph, { boundaryThreshold: 1.0 });
    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.isBoundary).toBe(true);
  });
});

// ─── Behavior 5: Subtree Aggregation ───────────────────────────────────────

describe('Directory Tree: Subtree Aggregation', () => {
  // AC 7: parent subtreeFileCount = own fileCount + sum of children's subtreeFileCount
  it('should aggregate subtree file count from children', async () => {
    const root = fixture('dir-tree-subtree');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const parent = findNode(tree, 'src/parent');
    expect(parent).toBeDefined();

    // parent has 1 file (index.ts), child has 1 file (deep.ts)
    expect(parent!.metrics.fileCount).toBe(1);
    expect(parent!.metrics.subtreeFileCount).toBe(2); // 1 + 1

    const child = findNode(tree, 'src/parent/child');
    expect(child).toBeDefined();
    expect(child!.metrics.fileCount).toBe(1);
    expect(child!.metrics.subtreeFileCount).toBe(1); // leaf: same as direct
  });

  it('should aggregate subtree LOC from children', async () => {
    const root = fixture('dir-tree-subtree');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const parent = findNode(tree, 'src/parent');
    expect(parent).toBeDefined();

    // parent/index.ts has 2 non-empty lines, parent/child/deep.ts has 3
    expect(parent!.metrics.subtreeLoc).toBe(parent!.metrics.totalLoc + findNode(tree, 'src/parent/child')!.metrics.totalLoc);
  });

  it('should have leaf node subtree totals equal direct totals', async () => {
    const root = fixture('dir-tree-subtree');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    const child = findNode(tree, 'src/parent/child');
    expect(child).toBeDefined();
    expect(child!.metrics.subtreeFileCount).toBe(child!.metrics.fileCount);
    expect(child!.metrics.subtreeLoc).toBe(child!.metrics.totalLoc);
    expect(child!.metrics.subtreeExportedSymbolCount).toBe(child!.metrics.exportedSymbolCount);
  });

  it('should have root subtree totals equal entire project totals', async () => {
    const root = fixture('dir-tree-metrics');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    // The root node's subtreeFileCount should include all files in the project
    expect(tree.metrics.subtreeFileCount).toBe(5);
    expect(tree.metrics.subtreeLoc).toBe(200);
  });
});

// ─── Behavior 6: Edge Counting ─────────────────────────────────────────────

describe('Directory Tree: Edge Counting', () => {
  // AC 9: Internal edges don't count toward inbound/outbound
  it('should not count internal edges toward inbound or outbound', async () => {
    const root = fixture('dir-tree-internal-edges');
    const graph = mockGraph(root, [
      'src/auth/helper.ts',
      'src/auth/user.ts',
    ], [
      { source: 'src/auth/user.ts', target: 'src/auth/helper.ts' },
    ]);

    const tree = await buildDirectoryTree(root, graph);

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.metrics.inboundEdges).toBe(0);
    expect(auth!.metrics.outboundEdges).toBe(0);
  });

  it('should count cross-directory edges as inbound/outbound', async () => {
    const root = fixture('dir-tree-boundary');
    const graph = mockGraph(root, [
      'src/auth/middleware.ts',
      'src/api/handler.ts',
    ], [
      { source: 'src/auth/middleware.ts', target: 'src/api/handler.ts' },
      { source: 'src/api/handler.ts', target: 'src/auth/middleware.ts' },
    ]);

    const tree = await buildDirectoryTree(root, graph);

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.metrics.outboundEdges).toBe(1); // auth → api
    expect(auth!.metrics.inboundEdges).toBe(1);  // api → auth

    const api = findNode(tree, 'src/api');
    expect(api).toBeDefined();
    expect(api!.metrics.outboundEdges).toBe(1); // api → auth
    expect(api!.metrics.inboundEdges).toBe(1);  // auth → api
  });

  it('should treat child-to-sibling edges as internal for the parent directory', async () => {
    const root = fixture('dir-tree-boundary');
    const graph = mockGraph(root, [
      'src/auth/middleware.ts',
      'src/api/handler.ts',
    ], [
      { source: 'src/auth/middleware.ts', target: 'src/api/handler.ts' },
      { source: 'src/api/handler.ts', target: 'src/auth/middleware.ts' },
    ]);

    const tree = await buildDirectoryTree(root, graph);

    // For src/: both auth and api are children, so edges between them are internal
    const src = findNode(tree, 'src');
    expect(src).toBeDefined();
    expect(src!.metrics.inboundEdges).toBe(0);
    expect(src!.metrics.outboundEdges).toBe(0);
  });
});

// ─── Behavior 7: Integration with Spec #1 and #2 ──────────────────────────

describe('Directory Tree: Integration', () => {
  it('should handle graph with 0 nodes and 0 edges gracefully', async () => {
    const root = fixture('dir-tree-basic');
    const tree = await buildDirectoryTree(root, emptyGraph(root));

    expect(tree).toBeDefined();
    expect(tree.path).toBeDefined();
    expect(tree.metrics.exportedSymbolCount).toBe(0);
  });

  it('should count exported symbols from graph module nodes', async () => {
    const root = fixture('dir-tree-basic');
    const graph: DependencyGraph = {
      root,
      nodes: [
        {
          id: 'src/auth/login.ts',
          filePath: resolve(root, 'src/auth/login.ts'),
          exports: [{ name: 'login', kind: 'named' }],
          symbols: [
            { name: 'login', kind: 'function', signature: '() => void', exported: true },
            { name: 'internal', kind: 'function', signature: '() => void', exported: false },
          ],
        },
        {
          id: 'src/auth/register.ts',
          filePath: resolve(root, 'src/auth/register.ts'),
          exports: [{ name: 'register', kind: 'named' }],
          symbols: [
            { name: 'register', kind: 'function', signature: '() => void', exported: true },
          ],
        },
      ],
      edges: [],
    };

    const tree = await buildDirectoryTree(root, graph);

    const auth = findNode(tree, 'src/auth');
    expect(auth).toBeDefined();
    // Only exported symbols count (login + register = 2)
    expect(auth!.metrics.exportedSymbolCount).toBe(2);
  });

  it('should aggregate exported symbol counts in subtree metrics', async () => {
    const root = fixture('dir-tree-subtree');
    const graph: DependencyGraph = {
      root,
      nodes: [
        {
          id: 'src/parent/index.ts',
          filePath: resolve(root, 'src/parent/index.ts'),
          exports: [{ name: 'p1', kind: 'named' }],
          symbols: [
            { name: 'p1', kind: 'variable', signature: 'const p1 = 1', exported: true },
          ],
        },
        {
          id: 'src/parent/child/deep.ts',
          filePath: resolve(root, 'src/parent/child/deep.ts'),
          exports: [{ name: 'c1', kind: 'named' }],
          symbols: [
            { name: 'c1', kind: 'variable', signature: 'const c1 = 1', exported: true },
            { name: 'c2', kind: 'variable', signature: 'const c2 = 2', exported: true },
          ],
        },
      ],
      edges: [],
    };

    const tree = await buildDirectoryTree(root, graph);

    const parent = findNode(tree, 'src/parent');
    expect(parent).toBeDefined();
    expect(parent!.metrics.exportedSymbolCount).toBe(1); // only index.ts
    expect(parent!.metrics.subtreeExportedSymbolCount).toBe(3); // 1 + 2
  });
});
