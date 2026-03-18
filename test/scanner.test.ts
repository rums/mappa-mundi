import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { scan } from '../src/scanner';
import type { DependencyGraph, ImportEdge, ModuleNode } from '../src/types';

// Helper to get fixture path
const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

// Helper to find an edge by source and target ids
function findEdge(graph: DependencyGraph, source: string, target: string): ImportEdge | undefined {
  return graph.edges.find(e => e.source === source && e.target === target);
}

// Helper to find a node by id
function findNode(graph: DependencyGraph, id: string): ModuleNode | undefined {
  return graph.nodes.find(n => n.id === id);
}

describe('Scanner: Basic Graph Construction', () => {
  // AC 1: 3-file chain A→B→C produces 3 nodes, 2 edges
  it('should produce 3 nodes and 2 edges for a linear A→B→C chain', async () => {
    const graph = await scan(fixture('basic-chain'));

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);

    // A→B edge exists
    const abEdge = findEdge(graph, 'a.ts', 'b.ts');
    expect(abEdge).toBeDefined();
    expect(abEdge!.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'greet', kind: 'named' }),
      ])
    );

    // B→C edge exists
    const bcEdge = findEdge(graph, 'b.ts', 'c.ts');
    expect(bcEdge).toBeDefined();
    expect(bcEdge!.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', kind: 'named' }),
      ])
    );
  });

  it('should produce 3 nodes and 2 edges for fan-out (A imports B and C)', async () => {
    const graph = await scan(fixture('fan-out'));

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(findEdge(graph, 'a.ts', 'b.ts')).toBeDefined();
    expect(findEdge(graph, 'a.ts', 'c.ts')).toBeDefined();
  });

  it('should produce 3 nodes and 2 edges for fan-in (B and C both import A)', async () => {
    const graph = await scan(fixture('fan-in'));

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(findEdge(graph, 'b.ts', 'a.ts')).toBeDefined();
    expect(findEdge(graph, 'c.ts', 'a.ts')).toBeDefined();
  });

  // AC 9: Circular dependencies A→B→A produce 2 nodes, 2 edges without infinite loops
  it('should handle circular dependencies without infinite loops', async () => {
    const graph = await scan(fixture('circular'));

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    expect(findEdge(graph, 'a.ts', 'b.ts')).toBeDefined();
    expect(findEdge(graph, 'b.ts', 'a.ts')).toBeDefined();
  });

  it('should set root to the project root path', async () => {
    const projectRoot = fixture('basic-chain');
    const graph = await scan(projectRoot);

    expect(graph.root).toBe(projectRoot);
  });

  it('should use relative file paths from project root as node ids', async () => {
    const graph = await scan(fixture('basic-chain'));

    const ids = graph.nodes.map(n => n.id).sort();
    expect(ids).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('should set absolute file paths on nodes', async () => {
    const projectRoot = fixture('basic-chain');
    const graph = await scan(projectRoot);

    for (const node of graph.nodes) {
      expect(node.filePath).toBe(resolve(projectRoot, node.id));
    }
  });
});

describe('Scanner: Import Kind Extraction', () => {
  // AC 2: Named, default, and namespace imports from same module → 1 edge, 3 ImportInfo entries
  it('should produce 1 edge with 3 ImportInfo entries for mixed import kinds from same module', async () => {
    const graph = await scan(fixture('import-kinds'));

    const edge = findEdge(graph, 'source.ts', 'target.ts');
    expect(edge).toBeDefined();
    expect(edge!.imports).toHaveLength(3);

    const kinds = edge!.imports.map(i => i.kind).sort();
    expect(kinds).toEqual(['default', 'named', 'namespace']);

    // Verify specific imports
    expect(edge!.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'default', kind: 'default' }),
        expect.objectContaining({ name: 'namedExport', kind: 'named' }),
        expect.objectContaining({ kind: 'namespace' }),
      ])
    );
  });

  it('should capture aliased named imports with name and alias', async () => {
    const graph = await scan(fixture('import-kinds'));

    const edge = findEdge(graph, 'aliased.ts', 'target.ts');
    expect(edge).toBeDefined();
    expect(edge!.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'namedExport',
          alias: 'renamed',
          kind: 'named',
        }),
      ])
    );
  });

  // AC 7: type-only import produces edge with kind 'type-only'
  it('should produce an edge with kind type-only for import type statements', async () => {
    const graph = await scan(fixture('type-only'));

    const edge = findEdge(graph, 'consumer.ts', 'types.ts');
    expect(edge).toBeDefined();
    expect(edge!.imports).toHaveLength(1);
    expect(edge!.imports[0].kind).toBe('type-only');
    expect(edge!.imports[0].name).toBe('Foo');
  });

  // AC 8: side-effect import produces edge with kind 'side-effect'
  it('should produce an edge with kind side-effect for bare import statements', async () => {
    const graph = await scan(fixture('side-effect'));

    const edge = findEdge(graph, 'consumer.ts', 'polyfill.ts');
    expect(edge).toBeDefined();
    expect(edge!.imports).toHaveLength(1);
    expect(edge!.imports[0].kind).toBe('side-effect');
  });
});

describe('Scanner: Barrel Files and Re-exports', () => {
  // AC 3: barrel file re-exports produce edges and ExportInfo with kind 're-export'
  it('should capture re-export edges from barrel file to sub-modules', async () => {
    const graph = await scan(fixture('barrel'));

    // index.ts should have edges to sub-a, sub-b, sub-c
    expect(findEdge(graph, 'index.ts', 'sub-a.ts')).toBeDefined();
    expect(findEdge(graph, 'index.ts', 'sub-b.ts')).toBeDefined();
    expect(findEdge(graph, 'index.ts', 'sub-c.ts')).toBeDefined();
  });

  it('should include re-exported symbols in barrel file ExportInfo', async () => {
    const graph = await scan(fixture('barrel'));

    const barrelNode = findNode(graph, 'index.ts');
    expect(barrelNode).toBeDefined();
    expect(barrelNode!.exports.length).toBeGreaterThanOrEqual(3);

    const reExportKinds = barrelNode!.exports.filter(e => e.kind === 're-export');
    expect(reExportKinds.length).toBeGreaterThanOrEqual(3);

    // Check specific re-exports
    expect(barrelNode!.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'foo', kind: 're-export', source: 'sub-a.ts' }),
        expect.objectContaining({ name: 'bar', kind: 're-export', source: 'sub-b.ts' }),
        expect.objectContaining({ name: 'Baz', kind: 're-export', source: 'sub-c.ts' }),
      ])
    );
  });

  it('should resolve directory imports to index.ts', async () => {
    const graph = await scan(fixture('directory-import'));

    // consumer.ts imports from './components' which should resolve to components/index.ts
    const edge = findEdge(graph, 'consumer.ts', 'components/index.ts');
    expect(edge).toBeDefined();
  });
});

describe('Scanner: Path Alias Resolution', () => {
  // AC 4: tsconfig path aliases resolve to correct target module
  it('should resolve @/* path alias to src/* target', async () => {
    const graph = await scan(fixture('path-aliases'), {
      tsConfigPath: resolve(fixture('path-aliases'), 'tsconfig.json'),
    });

    // src/app.ts imports '@/utils/helper' → should resolve to src/utils/helper.ts
    const edge = findEdge(graph, 'src/app.ts', 'src/utils/helper.ts');
    expect(edge).toBeDefined();
    expect(edge!.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'helper', kind: 'named' }),
      ])
    );
  });

  it('should resolve @components/* path alias to src/components/*', async () => {
    const graph = await scan(fixture('path-aliases'), {
      tsConfigPath: resolve(fixture('path-aliases'), 'tsconfig.json'),
    });

    // src/app.ts imports '@components/Button' → should resolve to src/components/Button.ts
    const edge = findEdge(graph, 'src/app.ts', 'src/components/Button.ts');
    expect(edge).toBeDefined();
  });
});

describe('Scanner: Isolated Nodes and Edge Cases', () => {
  // AC 5: file with no imports/exports appears as isolated node
  it('should include files with no imports or exports as isolated nodes', async () => {
    const graph = await scan(fixture('isolated'));

    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
    const standaloneNode = findNode(graph, 'standalone.ts');
    expect(standaloneNode).toBeDefined();
    expect(standaloneNode!.exports).toHaveLength(0);

    // No edges from or to standalone
    const relatedEdges = graph.edges.filter(
      e => e.source === 'standalone.ts' || e.target === 'standalone.ts'
    );
    expect(relatedEdges).toHaveLength(0);
  });

  it('should include empty files as nodes with empty exports', async () => {
    const graph = await scan(fixture('isolated'));

    const emptyNode = findNode(graph, 'empty.ts');
    expect(emptyNode).toBeDefined();
    expect(emptyNode!.exports).toHaveLength(0);
  });

  // AC 10: syntax error file still produces a node with empty exports, scan completes
  it('should complete scan even with syntax error files', async () => {
    const graph = await scan(fixture('syntax-error'));

    // Scan should not throw
    expect(graph).toBeDefined();

    // Bad file should still appear as a node
    const badNode = findNode(graph, 'bad.ts');
    expect(badNode).toBeDefined();
    expect(badNode!.exports).toHaveLength(0);

    // Good file should still be processed correctly
    const goodNode = findNode(graph, 'good.ts');
    expect(goodNode).toBeDefined();
  });
});

describe('Scanner: JSON Serialization', () => {
  // AC 6: graph round-trips through JSON.stringify/JSON.parse
  it('should round-trip through JSON serialization', async () => {
    const graph = await scan(fixture('basic-chain'));

    const serialized = JSON.stringify(graph);
    const deserialized: DependencyGraph = JSON.parse(serialized);

    expect(deserialized).toEqual(graph);
  });

  it('should round-trip an empty graph', async () => {
    const graph = await scan(fixture('isolated'));

    const serialized = JSON.stringify(graph);
    const deserialized: DependencyGraph = JSON.parse(serialized);

    expect(deserialized.nodes).toEqual(graph.nodes);
    expect(deserialized.edges).toEqual(graph.edges);
    expect(deserialized.root).toEqual(graph.root);
  });
});
