import type { DependencyGraph, SemanticZoomLevel, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';
import { deriveRelationships } from './relationships';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generateId(): string {
  return 'szl-' + Math.random().toString(36).slice(2, 10);
}

export function buildFallback(
  graph: DependencyGraph,
  dirTree: DirectoryNode,
): SemanticZoomLevel {
  const allModuleIds = graph.nodes.map((n) => n.id);
  const assigned = new Set<string>();

  // One region per top-level child directory
  const regionModuleMap: Record<string, string[]> = {};
  const regions: Region[] = [];

  for (const child of dirTree.children) {
    const regionId = `region-${child.name.toLowerCase()}`;
    const childPath = child.path.endsWith('/') ? child.path : child.path + '/';

    const modules = allModuleIds.filter((id) => id.startsWith(childPath));
    for (const m of modules) assigned.add(m);

    regionModuleMap[regionId] = modules;

    regions.push({
      id: regionId,
      name: titleCase(child.name),
      moduleCount: modules.length,
      loc: child.metrics.subtreeLoc,
    });
  }

  // Handle root-level files not under any child directory
  const unassigned = allModuleIds.filter((id) => !assigned.has(id));
  if (unassigned.length > 0) {
    const rootRegionId = `region-${dirTree.name.toLowerCase()}`;
    regionModuleMap[rootRegionId] = unassigned;

    regions.push({
      id: rootRegionId,
      name: titleCase(dirTree.name),
      moduleCount: unassigned.length,
      loc: dirTree.metrics.totalLoc,
    });
  }

  const relationships = deriveRelationships(graph.edges, regionModuleMap);

  return {
    id: generateId(),
    label: 'Top Level',
    regions,
    relationships,
  };
}
