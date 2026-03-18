import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { scan } from '../src/scanner';
import type { DependencyGraph, ModuleNode, SymbolInfo } from '../src/types';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

// Helper to find a node by id
function findNode(graph: DependencyGraph, id: string): ModuleNode | undefined {
  return graph.nodes.find(n => n.id === id);
}

// Helper to find a symbol within a node
function findSymbol(node: ModuleNode, name: string): SymbolInfo | undefined {
  return node.symbols.find(s => s.name === name);
}

describe('Scanner: Symbol Integration with Dependency Graph', () => {
  // AC 7: After scanning, each ModuleNode has a populated symbols array
  it('should populate symbols array on each ModuleNode after scanning', async () => {
    const graph = await scan(fixture('symbols-integration'));

    for (const node of graph.nodes) {
      expect(node).toHaveProperty('symbols');
      expect(Array.isArray(node.symbols)).toBe(true);
    }
  });

  it('should attach correct symbols to correct ModuleNode by id', async () => {
    const graph = await scan(fixture('symbols-integration'));

    const moduleA = findNode(graph, 'module-a.ts');
    expect(moduleA).toBeDefined();
    expect(findSymbol(moduleA!, 'User')).toBeDefined();
    expect(findSymbol(moduleA!, 'greet')).toBeDefined();
    expect(findSymbol(moduleA!, 'Status')).toBeDefined();

    const moduleB = findNode(graph, 'module-b.ts');
    expect(moduleB).toBeDefined();
    expect(findSymbol(moduleB!, 'helper')).toBeDefined();
    expect(findSymbol(moduleB!, 'VERSION')).toBeDefined();
  });

  // AC 8: A module with no declarations has symbols: []
  it('should have empty symbols array for module with no declarations', async () => {
    const graph = await scan(fixture('symbols-empty'));

    const emptyNode = findNode(graph, 'empty.ts');
    expect(emptyNode).toBeDefined();
    expect(emptyNode!.symbols).toEqual([]);
  });

  // AC 10: Barrel file with only re-exports has symbols: []
  it('should have empty symbols array for barrel file with only re-exports', async () => {
    const graph = await scan(fixture('symbols-barrel'));

    const barrelNode = findNode(graph, 'index.ts');
    expect(barrelNode).toBeDefined();
    // Re-exports are NOT local declarations — barrel file symbols should be empty
    expect(barrelNode!.symbols).toEqual([]);
  });

  it('should still have symbols on sub-modules referenced by barrel', async () => {
    const graph = await scan(fixture('symbols-barrel'));

    const subA = findNode(graph, 'sub-a.ts');
    expect(subA).toBeDefined();
    expect(subA!.symbols.length).toBeGreaterThan(0);
    expect(findSymbol(subA!, 'foo')).toBeDefined();

    const subB = findNode(graph, 'sub-b.ts');
    expect(subB).toBeDefined();
    expect(subB!.symbols.length).toBeGreaterThan(0);
    expect(findSymbol(subB!, 'bar')).toBeDefined();
  });

  it('should preserve existing graph data alongside new symbols', async () => {
    const graph = await scan(fixture('symbols-integration'));

    // Graph structure still works
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    expect(graph.root).toBe(fixture('symbols-integration'));

    // Nodes still have their existing fields
    const moduleA = findNode(graph, 'module-a.ts');
    expect(moduleA!.id).toBe('module-a.ts');
    expect(moduleA!.filePath).toBe(resolve(fixture('symbols-integration'), 'module-a.ts'));
    expect(moduleA!.exports).toBeDefined();
  });

  it('should round-trip through JSON serialization with symbols included', async () => {
    const graph = await scan(fixture('symbols-integration'));

    const serialized = JSON.stringify(graph);
    const deserialized: DependencyGraph = JSON.parse(serialized);

    expect(deserialized).toEqual(graph);

    // Specifically verify symbols survived serialization
    const node = deserialized.nodes.find(n => n.id === 'module-a.ts');
    expect(node).toBeDefined();
    expect(node!.symbols.length).toBeGreaterThan(0);
  });
});
