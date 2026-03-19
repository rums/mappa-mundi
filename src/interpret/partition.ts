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
  const rawClusters: string[][] = [];
  for (const component of components) {
    if (component.length <= targetRange.max) {
      rawClusters.push(component);
    } else {
      // Split into chunks of targetRange.max
      for (let i = 0; i < component.length; i += targetRange.max) {
        rawClusters.push(component.slice(i, i + targetRange.max));
      }
    }
  }

  // Merge undersized clusters (< min) into neighbours
  // Sort so smallest clusters get merged first
  const sorted = rawClusters
    .map((c, i) => ({ cluster: c, index: i }))
    .sort((a, b) => a.cluster.length - b.cluster.length);

  const merged: string[][] = [];
  const consumed = new Set<number>();

  for (const entry of sorted) {
    if (consumed.has(entry.index)) continue;

    if (entry.cluster.length >= targetRange.min) {
      merged.push(entry.cluster);
      consumed.add(entry.index);
      continue;
    }

    // Try to merge this small cluster into the last merged group that has room
    let placed = false;
    for (const group of merged) {
      if (group.length + entry.cluster.length <= targetRange.max) {
        group.push(...entry.cluster);
        consumed.add(entry.index);
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Start a new group with this small cluster
      merged.push([...entry.cluster]);
      consumed.add(entry.index);
    }
  }

  // Final pass: if any remaining groups are still undersized, merge them with their smallest neighbour
  let clusters = merged;
  if (clusters.length >= 2) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = clusters.length - 1; i >= 0; i--) {
        if (clusters[i].length >= targetRange.min) continue;
        // Find the smallest other cluster we can merge into
        let bestIdx = -1;
        let bestSize = Infinity;
        for (let j = 0; j < clusters.length; j++) {
          if (j === i) continue;
          const combined = clusters[j].length + clusters[i].length;
          if (combined <= targetRange.max && clusters[j].length < bestSize) {
            bestIdx = j;
            bestSize = clusters[j].length;
          }
        }
        if (bestIdx >= 0) {
          clusters[bestIdx].push(...clusters[i]);
          clusters.splice(i, 1);
          changed = true;
          break; // restart scan after mutation
        }
      }
    }
  }

  // If only one cluster, try to split it
  if (clusters.length === 1 && clusters[0].length >= targetRange.min * 2) {
    const all = clusters[0];
    const mid = Math.ceil(all.length / 2);
    clusters = [all.slice(0, mid), all.slice(mid)];
  }

  // Final guard: if we still have too many clusters, combine the smallest pairs
  while (clusters.length > targetRange.max) {
    // Sort by size ascending and merge the two smallest
    clusters.sort((a, b) => a.length - b.length);
    const a = clusters.shift()!;
    const b = clusters.shift()!;
    clusters.push([...a, ...b]);
  }

  return {
    clusters,
    algorithm: 'leiden',
    resolution: 1.0,
  };
}
