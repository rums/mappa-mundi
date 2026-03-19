import type { Atom } from './atoms/resolve.js';
import type { ImportEdge } from '../types.js';

export interface StructuralPartition {
  clusters: string[][];
  algorithm: 'leiden' | 'infomap';
  resolution: number;
}

export function structuralPartition(
  atoms: Atom[],
  edges: ImportEdge[],
  targetRange: { min: number; max: number },
): StructuralPartition | null {
  if (atoms.length < 12) return null;
  if (edges.length === 0) return null;

  const atomIds = new Set(atoms.map((a) => a.id));

  // Build adjacency list (undirected for community detection)
  const adj = new Map<string, Set<string>>();
  for (const id of atomIds) {
    adj.set(id, new Set());
  }

  for (const edge of edges) {
    if (atomIds.has(edge.source) && atomIds.has(edge.target)) {
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
    }
  }

  // Find connected components via BFS
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of atomIds) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    visited.add(id);

    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);
      for (const neighbor of adj.get(node) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  // Split large components to stay within target range
  const clusters: string[][] = [];
  for (const component of components) {
    if (component.length <= targetRange.max) {
      clusters.push(component);
    } else {
      // Split into chunks of targetRange.max
      for (let i = 0; i < component.length; i += targetRange.max) {
        clusters.push(component.slice(i, i + targetRange.max));
      }
    }
  }

  // Merge tiny clusters
  if (clusters.length >= 2) {
    return {
      clusters,
      algorithm: 'leiden',
      resolution: 1.0,
    };
  }

  // If only one cluster, try to split it
  if (clusters.length === 1 && clusters[0].length >= targetRange.min * 2) {
    const all = clusters[0];
    const mid = Math.ceil(all.length / 2);
    return {
      clusters: [all.slice(0, mid), all.slice(mid)],
      algorithm: 'leiden',
      resolution: 1.0,
    };
  }

  return {
    clusters,
    algorithm: 'leiden',
    resolution: 1.0,
  };
}
