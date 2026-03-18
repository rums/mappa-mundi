import type { ImportEdge, Relationship } from '../types';

export function deriveRelationships(
  edges: ImportEdge[],
  regionModuleMap: Record<string, string[]>,
): Relationship[] {
  // Build reverse map: moduleId → regionId
  const moduleToRegion = new Map<string, string>();
  for (const [regionId, modules] of Object.entries(regionModuleMap)) {
    for (const moduleId of modules) {
      moduleToRegion.set(moduleId, regionId);
    }
  }

  // Aggregate edges per (sourceRegionId, targetRegionId) pair
  const counts = new Map<string, number>();

  for (const edge of edges) {
    const sourceRegion = moduleToRegion.get(edge.source);
    const targetRegion = moduleToRegion.get(edge.target);

    // Skip if either module not in any region, or same region (internal)
    if (!sourceRegion || !targetRegion) continue;
    if (sourceRegion === targetRegion) continue;

    const key = `${sourceRegion}|||${targetRegion}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const relationships: Relationship[] = [];
  for (const [key, edgeCount] of counts) {
    const [sourceId, targetId] = key.split('|||');
    relationships.push({
      sourceId,
      targetId,
      kind: 'depends-on',
      edgeCount,
    });
  }

  return relationships;
}
