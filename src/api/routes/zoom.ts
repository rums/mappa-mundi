import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';
import type { DependencyGraph, Region, Relationship, SemanticZoomLevel } from '../../types.js';
import type { DirectoryNode } from '../../directory-tree.js';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generateId(): string {
  return 'szl-' + Math.random().toString(36).slice(2, 10);
}

/** Recursively find a DirectoryNode by name (case-insensitive). */
function findDirNode(node: DirectoryNode, name: string): DirectoryNode | undefined {
  for (const child of node.children) {
    if (child.name.toLowerCase() === name) return child;
    const found = findDirNode(child, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Build a sub-level for a set of modules, grouped by immediate sub-directories
 * of the given directory node.
 */
function buildSubLevel(
  label: string,
  regionModules: string[],
  graph: DependencyGraph,
  dirNode: DirectoryNode | undefined,
): SemanticZoomLevel {
  const subRegions: Region[] = [];
  const subRegionModuleMap: Record<string, string[]> = {};

  if (dirNode && dirNode.children.length > 0) {
    const assigned = new Set<string>();

    for (const child of dirNode.children) {
      const childPath = child.path.endsWith('/') ? child.path : child.path + '/';
      const modules = regionModules.filter((id) => id.startsWith(childPath));
      if (modules.length === 0) continue;

      for (const m of modules) assigned.add(m);

      const subRegionId = `region-${child.name.toLowerCase()}`;
      subRegionModuleMap[subRegionId] = modules;

      subRegions.push({
        id: subRegionId,
        name: titleCase(child.name),
        moduleCount: modules.length,
        loc: child.metrics.subtreeLoc,
      });
    }

    // Files directly in this directory (not in a sub-directory)
    const unassigned = regionModules.filter((id) => !assigned.has(id));
    if (unassigned.length > 0) {
      const rootId = `region-${dirNode.name.toLowerCase()}-files`;
      subRegionModuleMap[rootId] = unassigned;

      subRegions.push({
        id: rootId,
        name: `${label} (files)`,
        moduleCount: unassigned.length,
        loc: dirNode.metrics.totalLoc,
      });
    }
  } else {
    // Leaf directory — show individual modules as regions
    for (const moduleId of regionModules) {
      const node = graph.nodes.find((n) => n.id === moduleId);
      const filename = moduleId.split('/').pop() || moduleId;

      const subRegionId = `module-${filename.replace(/\.[^.]+$/, '')}`;
      subRegionModuleMap[subRegionId] = [moduleId];

      subRegions.push({
        id: subRegionId,
        name: filename,
        moduleCount: 1,
        loc: node ? node.symbols.length : 0,
      });
    }
  }

  const relationships = deriveSubRelationships(graph, subRegionModuleMap);

  return {
    id: generateId(),
    label,
    regions: subRegions,
    relationships,
  };
}

function deriveSubRelationships(
  graph: DependencyGraph,
  regionModuleMap: Record<string, string[]>,
): Relationship[] {
  const moduleToRegion = new Map<string, string>();
  for (const [regionId, modules] of Object.entries(regionModuleMap)) {
    for (const m of modules) {
      moduleToRegion.set(m, regionId);
    }
  }

  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    const sourceRegion = moduleToRegion.get(edge.source);
    const targetRegion = moduleToRegion.get(edge.target);
    if (sourceRegion && targetRegion && sourceRegion !== targetRegion) {
      const key = `${sourceRegion}::${targetRegion}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  const relationships: Relationship[] = [];
  for (const [key, count] of edgeCounts) {
    const [source, target] = key.split('::');
    relationships.push({
      sourceId: source,
      targetId: target,
      kind: 'depends-on',
      edgeCount: count,
    });
  }
  return relationships;
}

export function registerZoomRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // In-memory map of regionId -> module list, built during zoom
  const regionModuleCache = new Map<string, string[]>();

  app.get('/api/zoom/:regionId', async (request, reply) => {
    const { regionId } = request.params as { regionId: string };

    if (!orchestrator.getActiveProjectPath()) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    const zoomLevel = orchestrator.getLastZoomLevel();
    const graph = orchestrator.getLastGraph();
    const dirTree = orchestrator.getLastDirTree();

    if (!zoomLevel || !graph || !dirTree) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    // Look up region and its modules
    const topRegion = zoomLevel.regions.find(r => r.id === regionId);
    let regionModules: string[] | undefined;
    let regionLabel: string;

    // Check orchestrator's module map first (works for both LLM and fallback regions)
    const storedModuleMap = orchestrator.getRegionModuleMap();

    if (topRegion) {
      regionLabel = topRegion.name;

      // Use stored module map if available
      if (storedModuleMap && storedModuleMap[regionId]) {
        regionModules = storedModuleMap[regionId];
      } else {
        // Fallback: reconstruct from directory tree
        const regionDirName = topRegion.name.toLowerCase();
        const regionDir = dirTree.children.find(
          (c) => c.name.toLowerCase() === regionDirName,
        );

        if (regionDir) {
          const dirPath = regionDir.path.endsWith('/') ? regionDir.path : regionDir.path + '/';
          regionModules = graph.nodes.map((n) => n.id).filter((id) => id.startsWith(dirPath));
        } else {
          const allChildPaths = dirTree.children.map(
            (c) => c.path.endsWith('/') ? c.path : c.path + '/',
          );
          regionModules = graph.nodes
            .map((n) => n.id)
            .filter((id) => !allChildPaths.some((p) => id.startsWith(p)));
        }
      }
    } else {
      // Sub-region — check the zoom-level module cache
      regionModules = regionModuleCache.get(regionId);
      if (!regionModules) {
        return reply.status(404).send({
          error: { code: 'REGION_NOT_FOUND', message: `Region not found: ${regionId}` },
        });
      }
      const namePart = regionId.replace(/^(region-|module-)/, '');
      regionLabel = titleCase(namePart);
    }

    if (regionModules.length === 0) {
      return reply.status(200).send({
        level: {
          id: generateId(),
          label: regionLabel || regionId,
          regions: [],
          relationships: [],
        },
        cached: false,
      });
    }

    // Find the matching directory node anywhere in the tree
    const dirName = regionLabel.toLowerCase();
    const dirNode = findDirNode(dirTree, dirName) ??
      dirTree.children.find((c) => c.name.toLowerCase() === dirName);

    const subLevel = buildSubLevel(regionLabel, regionModules, graph, dirNode);

    // Cache module lists for each sub-region so deeper zooms work
    for (const subRegion of subLevel.regions) {
      // Find modules for this sub-region from the buildSubLevel logic
      if (dirNode) {
        for (const child of dirNode.children) {
          const childRegionId = `region-${child.name.toLowerCase()}`;
          if (subRegion.id === childRegionId) {
            const childPath = child.path.endsWith('/') ? child.path : child.path + '/';
            const modules = regionModules.filter((id) => id.startsWith(childPath));
            regionModuleCache.set(childRegionId, modules);
          }
        }
        // Files region
        const filesRegionId = `region-${dirNode.name.toLowerCase()}-files`;
        if (subRegion.id === filesRegionId) {
          const childPaths = dirNode.children.map(
            (c) => c.path.endsWith('/') ? c.path : c.path + '/',
          );
          const files = regionModules.filter(
            (id) => !childPaths.some((p) => id.startsWith(p)),
          );
          regionModuleCache.set(filesRegionId, files);
        }
      }
      // Module-level regions
      if (subRegion.id.startsWith('module-')) {
        const moduleId = regionModules.find((m) => {
          const filename = m.split('/').pop() || m;
          return subRegion.id === `module-${filename.replace(/\.[^.]+$/, '')}`;
        });
        if (moduleId) {
          regionModuleCache.set(subRegion.id, [moduleId]);
        }
      }
    }

    return reply.status(200).send({
      level: subLevel,
      cached: false,
    });
  });
}
