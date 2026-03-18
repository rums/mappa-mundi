import { describe, it, expect } from 'vitest';
import { LayerRegistry } from '../../src/layers/registry';
import type { Layer, LayerResult, LayerScore, LayerConfig } from '../../src/layers/types';
import type { DependencyGraph, Region } from '../../src/types';
import type { DirectoryNode } from '../../src/directory-tree';

// --- Stub layer for testing registry behavior ---

function makeStubLayer(id: string, name: string = id): Layer {
  return {
    id,
    name,
    description: `Stub layer: ${id}`,
    computeModuleScores(
      _graph: DependencyGraph,
      _dirTree: DirectoryNode,
      _config?: LayerConfig,
    ): LayerResult {
      return { layerId: id, moduleScores: new Map() };
    },
    aggregateToRegions(
      _moduleScores: Map<string, LayerScore>,
      _regions: Region[],
    ): Map<string, LayerScore> {
      return new Map();
    },
  };
}

describe('LayerRegistry', () => {
  // AC 9: LayerRegistry can register, list, and retrieve layers

  it('should register a layer and retrieve it by ID', () => {
    const registry = new LayerRegistry();
    const layer = makeStubLayer('test-coverage');

    registry.register(layer);
    const retrieved = registry.get('test-coverage');

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-coverage');
  });

  it('should return undefined for unknown layer ID', () => {
    const registry = new LayerRegistry();

    const result = registry.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should list all registered layers', () => {
    const registry = new LayerRegistry();
    registry.register(makeStubLayer('coverage'));
    registry.register(makeStubLayer('staleness'));
    registry.register(makeStubLayer('complexity'));

    const layers = registry.list();

    expect(layers).toHaveLength(3);
    const ids = layers.map((l) => l.id);
    expect(ids).toContain('coverage');
    expect(ids).toContain('staleness');
    expect(ids).toContain('complexity');
  });

  it('should overwrite layer when registering duplicate ID', () => {
    const registry = new LayerRegistry();
    registry.register(makeStubLayer('coverage', 'Old Coverage'));
    registry.register(makeStubLayer('coverage', 'New Coverage'));

    const layers = registry.list();
    expect(layers).toHaveLength(1);

    const retrieved = registry.get('coverage');
    expect(retrieved!.name).toBe('New Coverage');
  });

  it('should return empty list when no layers registered', () => {
    const registry = new LayerRegistry();
    expect(registry.list()).toHaveLength(0);
  });
});
