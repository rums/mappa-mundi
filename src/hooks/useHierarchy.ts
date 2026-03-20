import { useState, useEffect, useCallback, useRef } from 'react';
import type { SemanticZoomLevel } from '../types.js';
import type { HierarchyNode } from '../components/ZoomableCirclePackRenderer.js';

/**
 * Fetches zoom levels and builds a nested HierarchyNode tree
 * for the ZoomableCirclePackRenderer.
 *
 * Starts by fetching root, then pre-fetches one level of children.
 * Deeper levels are fetched on demand via `requestChildren`.
 */
export function useHierarchy(rootData: SemanticZoomLevel | null) {
  const [tree, setTree] = useState<HierarchyNode | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());

  // Build the initial tree from root scan data
  useEffect(() => {
    if (!rootData) {
      setTree(null);
      fetchedRef.current.clear();
      return;
    }

    const rootNode: HierarchyNode = {
      id: 'root',
      name: rootData.label || 'Project',
      moduleCount: rootData.regions.reduce((sum, r) => sum + r.moduleCount, 0),
      loc: rootData.regions.reduce((sum, r) => sum + r.loc, 0),
      children: rootData.regions.map((r) => ({
        id: r.id,
        name: r.name,
        moduleCount: r.moduleCount,
        loc: r.loc,
        childrenPending: r.moduleCount > 1, // assume zoomable if >1 module
      })),
    };

    setTree(rootNode);
    fetchedRef.current.clear();
    fetchedRef.current.add('root');

    // Pre-fetch one level deep for each region
    prefetchChildren(rootNode, rootData.regions.map((r) => r.id));
  }, [rootData]);

  // Pre-fetch children for a set of region IDs
  const prefetchChildren = useCallback(
    async (currentTree: HierarchyNode, regionIds: string[]) => {
      const toFetch = regionIds.filter((id) => !fetchedRef.current.has(id));
      if (toFetch.length === 0) return;

      setLoading(true);

      // Fetch all in parallel (with a concurrency limit)
      const results = await Promise.allSettled(
        toFetch.map(async (regionId) => {
          const res = await fetch(`/api/zoom/${regionId}`);
          if (!res.ok) return null;
          const json = await res.json();
          return { regionId, level: json.level as SemanticZoomLevel };
        }),
      );

      // Update the tree with fetched children
      setTree((prev) => {
        if (!prev) return prev;
        const updated = deepClone(prev);

        for (const result of results) {
          if (result.status !== 'fulfilled' || !result.value) continue;
          const { regionId, level } = result.value;
          fetchedRef.current.add(regionId);

          // Find the node in the tree and attach children
          const node = findNode(updated, regionId);
          if (node && level && level.regions.length > 0) {
            node.children = level.regions.map((r) => ({
              id: r.id,
              name: r.name,
              moduleCount: r.moduleCount,
              loc: r.loc,
              childrenPending: r.moduleCount > 1,
            }));
            node.childrenPending = false;
          } else if (node) {
            // No sub-regions — this is a leaf
            node.childrenPending = false;
            node.children = undefined;
          }
        }

        return updated;
      });

      setLoading(false);
    },
    [],
  );

  // Request children for a specific node (called when user zooms into it)
  const requestChildren = useCallback(
    (regionId: string) => {
      if (fetchedRef.current.has(regionId)) return;
      if (!tree) return;

      const node = findNode(tree, regionId);
      if (!node || !node.childrenPending) return;

      prefetchChildren(tree, [regionId]);
    },
    [tree, prefetchChildren],
  );

  return { tree, loading, requestChildren };
}

function findNode(tree: HierarchyNode, id: string): HierarchyNode | null {
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function deepClone(node: HierarchyNode): HierarchyNode {
  return {
    ...node,
    children: node.children?.map(deepClone),
  };
}
