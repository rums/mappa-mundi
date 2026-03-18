import type { LLMClient } from './cluster';
import type { DependencyGraph } from '../types';
import type { DirectoryNode } from '../directory-tree';
import type {
  SemanticRegion,
  SemanticZoomLevel,
  SemanticRelationship,
  ZoomCache,
} from '../semantic-zoom';
import { validateAndFix } from './validate';
import { createHash } from 'node:crypto';

export interface ZoomConfig {
  minClusterSize?: number;
  maxZoomDepth?: number;
  model?: string;
  maxRetries?: number;
}

const DEFAULT_MIN_CLUSTER_SIZE = 5;
const DEFAULT_MAX_ZOOM_DEPTH = 5;

function generateRegionId(): string {
  return 'zr-' + Math.random().toString(36).slice(2, 10);
}

function computeHash(modules: string[]): string {
  const h = createHash('sha256');
  h.update(modules.slice().sort().join('\n'));
  return h.digest('hex').slice(0, 12);
}

function extractDirectories(modules: string[]): string[] {
  const dirs = new Set<string>();
  for (const m of modules) {
    const parts = m.split('/');
    if (parts.length > 1) {
      dirs.add(parts.slice(0, -1).join('/'));
    }
  }
  return [...dirs];
}

function buildModuleLevelRegions(
  moduleIds: string[],
  graph: DependencyGraph,
): SemanticRegion[] {
  return moduleIds.map((moduleId) => {
    const filename = moduleId.split('/').pop() || moduleId;
    const node = graph.nodes.find((n) => n.id === moduleId);
    const exportedSymbols = node
      ? node.symbols.filter((s) => s.exported).map((s) => s.name)
      : [];
    const summary =
      exportedSymbols.length > 0
        ? `Exports: ${exportedSymbols.join(', ')}`
        : filename;

    return {
      id: generateRegionId(),
      name: filename,
      summary,
      modules: [moduleId],
      directories: extractDirectories([moduleId]),
      regionHash: computeHash([moduleId]),
    };
  });
}

function deriveZoomRelationships(
  regions: SemanticRegion[],
  graph: DependencyGraph,
): SemanticRelationship[] {
  // Build module -> region id map
  const moduleToRegion = new Map<string, string>();
  for (const region of regions) {
    for (const m of region.modules) {
      moduleToRegion.set(m, region.id);
    }
  }

  // Aggregate edges between regions
  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    const sourceRegion = moduleToRegion.get(edge.source);
    const targetRegion = moduleToRegion.get(edge.target);
    if (sourceRegion && targetRegion && sourceRegion !== targetRegion) {
      const key = `${sourceRegion}::${targetRegion}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  const relationships: SemanticRelationship[] = [];
  for (const [key, count] of edgeCounts) {
    const [source, target] = key.split('::');
    relationships.push({
      source,
      target,
      kind: 'depends-on',
      edgeCount: count,
    });
  }

  return relationships;
}

function buildFallbackRegions(
  moduleIds: string[],
  dirTree: DirectoryNode,
): SemanticRegion[] {
  // Try subdirectory grouping first
  if (dirTree.children.length > 0) {
    const dirGroups = new Map<string, string[]>();
    const childPaths = dirTree.children.map((c) => c.path);

    for (const moduleId of moduleIds) {
      let assigned = false;
      for (const childPath of childPaths) {
        if (moduleId.startsWith(childPath + '/')) {
          const existing = dirGroups.get(childPath) || [];
          existing.push(moduleId);
          dirGroups.set(childPath, existing);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        // Put in a catch-all group
        const existing = dirGroups.get('__root__') || [];
        existing.push(moduleId);
        dirGroups.set('__root__', existing);
      }
    }

    // Check if we actually got meaningful grouping
    if (dirGroups.size > 1 || (dirGroups.size === 1 && !dirGroups.has('__root__'))) {
      const regions: SemanticRegion[] = [];
      for (const [dirPath, modules] of dirGroups) {
        const name = dirPath === '__root__' ? 'root' : dirPath.split('/').pop() || dirPath;
        regions.push({
          id: generateRegionId(),
          name,
          summary: `Modules in ${dirPath}`,
          modules,
          directories: [dirPath],
          regionHash: computeHash(modules),
        });
      }
      return regions;
    }
  }

  // Alphabetical grouping: chunks of 3, ceil(n/3) groups
  const sorted = [...moduleIds].sort();
  const numGroups = Math.ceil(sorted.length / 3);
  const chunkSize = Math.ceil(sorted.length / numGroups);
  const regions: SemanticRegion[] = [];

  for (let i = 0; i < numGroups; i++) {
    const chunk = sorted.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;
    regions.push({
      id: generateRegionId(),
      name: `Group ${i + 1}`,
      summary: `Alphabetical group ${i + 1}`,
      modules: chunk,
      directories: extractDirectories(chunk),
      regionHash: computeHash(chunk),
    });
  }

  return regions;
}

const responseSchema = {
  type: 'object',
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          modules: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'summary', 'modules'],
      },
    },
  },
  required: ['regions'],
};

export async function zoomIntoRegion(
  region: SemanticRegion,
  graph: DependencyGraph,
  dirTree: DirectoryNode,
  llm: LLMClient,
  cache: ZoomCache,
  projectId: string,
  config?: ZoomConfig,
  currentDepth?: number,
): Promise<SemanticZoomLevel> {
  const depth = currentDepth ?? 0;
  const minClusterSize = config?.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const maxZoomDepth = config?.maxZoomDepth ?? DEFAULT_MAX_ZOOM_DEPTH;
  const maxRetries = config?.maxRetries ?? 2;

  // Filter graph to only modules in this region
  const moduleIds = region.modules;
  const moduleIdSet = new Set(moduleIds);
  const filteredGraph: DependencyGraph = {
    root: graph.root,
    nodes: graph.nodes.filter((n) => moduleIdSet.has(n.id)),
    edges: graph.edges.filter(
      (e) => moduleIdSet.has(e.source) && moduleIdSet.has(e.target),
    ),
  };

  // Check cache first
  const cached = cache.get(projectId, region.id, depth);
  if (cached && !cached.stale) {
    return cached.level;
  }

  // Module-level detail: below threshold or at max depth
  if (moduleIds.length < minClusterSize || depth >= maxZoomDepth) {
    const regions = buildModuleLevelRegions(moduleIds, filteredGraph);
    const relationships = deriveZoomRelationships(regions, filteredGraph);
    const result: SemanticZoomLevel = {
      path: region.id,
      depth,
      regions,
      relationships,
      sourceHash: region.regionHash,
      generatedAt: new Date().toISOString(),
    };
    cache.set(projectId, region.id, depth, result);
    return result;
  }

  // LLM clustering path
  let subRegions: SemanticRegion[] | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const prompt = buildZoomPrompt(region, moduleIds, filteredGraph);
      const response = await llm.complete(prompt, responseSchema);
      const validated = validateAndFix(response.content, moduleIds);

      if (validated.valid && validated.regions.length > 0) {
        // No-progress guard: if LLM returns 1 region with all modules, use fallback
        if (
          validated.regions.length === 1 &&
          validated.regions[0].modules.length === moduleIds.length
        ) {
          break; // fall through to fallback
        }

        subRegions = validated.regions.map((r) => ({
          id: generateRegionId(),
          name: r.name,
          summary: r.summary,
          modules: r.modules,
          directories: extractDirectories(r.modules),
          regionHash: computeHash(r.modules),
        }));
        break;
      }
    } catch {
      if (attempt === maxRetries) {
        break; // fall through to fallback
      }
    }
  }

  // Fallback if LLM failed or no progress
  if (!subRegions) {
    subRegions = buildFallbackRegions(moduleIds, dirTree);
  }

  const relationships = deriveZoomRelationships(subRegions, filteredGraph);
  const result: SemanticZoomLevel = {
    path: region.id,
    depth,
    regions: subRegions,
    relationships,
    sourceHash: region.regionHash,
    generatedAt: new Date().toISOString(),
  };

  cache.set(projectId, region.id, depth, result);
  return result;
}

function buildZoomPrompt(
  parentRegion: SemanticRegion,
  moduleIds: string[],
  graph: DependencyGraph,
): string {
  const moduleList = moduleIds
    .map((id) => {
      const node = graph.nodes.find((n) => n.id === id);
      const symbols = node
        ? node.symbols
            .filter((s) => s.exported)
            .map((s) => s.name)
            .join(', ')
        : '';
      return `- ${id}${symbols ? ` (exports: ${symbols})` : ''}`;
    })
    .join('\n');

  const edgeList = graph.edges
    .map((e) => `- ${e.source} -> ${e.target}`)
    .join('\n');

  return `You are analyzing a code region to identify meaningful sub-regions.

Parent region: ${parentRegion.name}
Parent summary: ${parentRegion.summary}

Modules in this region:
${moduleList}

Dependencies:
${edgeList || '(none)'}

Group these modules into 3-7 cohesive sub-regions based on their responsibilities and dependencies. Each module must appear in exactly one sub-region.

Return a JSON object with a "regions" array, where each region has:
- "name": a short descriptive name
- "summary": a one-sentence description
- "modules": array of module IDs from the list above`;
}
