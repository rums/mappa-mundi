import type { DependencyGraph, SemanticZoomLevel, Region } from '../types';
import type { DirectoryNode } from '../directory-tree';
import { buildPrompt } from './prompt';
import { validateAndFix } from './validate';
import { buildFallback } from './fallback';
import { deriveRelationships } from './relationships';

export interface LLMResponse {
  content: unknown;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMClient {
  complete(prompt: string, responseSchema: object): Promise<LLMResponse>;
}

export interface ClusteringConfig {
  model?: string;
  maxRetries?: number;
  maxRegions?: number;
  minRegions?: number;
  maxPromptTokens?: number;
}

function generateId(): string {
  return 'szl-' + Math.random().toString(36).slice(2, 10);
}

function estimateLoc(
  modules: string[],
  graph: DependencyGraph,
  dirTree: DirectoryNode,
): number {
  // Estimate LOC based on directory metrics or fallback to 50 per module
  // Try to find LOC from dirTree metrics
  let totalLoc = 0;
  for (const moduleId of modules) {
    // Find in dirTree files
    let found = false;
    const visit = (node: DirectoryNode): void => {
      if (found) return;
      if (node.files.includes(moduleId)) {
        // Estimate per-file LOC from directory metrics
        if (node.metrics.fileCount > 0) {
          totalLoc += Math.round(node.metrics.totalLoc / node.metrics.fileCount);
        } else {
          totalLoc += 50;
        }
        found = true;
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(dirTree);
    if (!found) totalLoc += 50;
  }
  return totalLoc;
}

export interface ClusterResult {
  zoomLevel: SemanticZoomLevel;
  regionModuleMap: Record<string, string[]>;
}

export async function clusterTopLevel(
  graph: DependencyGraph,
  dirTree: DirectoryNode,
  llm: LLMClient,
  config?: Partial<ClusteringConfig>,
): Promise<ClusterResult> {
  const maxRetries = config?.maxRetries ?? 3;
  const maxPromptTokens = config?.maxPromptTokens;

  const prompt = buildPrompt(graph, dirTree, maxPromptTokens ? { maxPromptTokens } : undefined);
  const allModuleIds = graph.nodes.map((n) => n.id);

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

  const totalAttempts = 1 + maxRetries;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await llm.complete(prompt, responseSchema);
      const content = response.content;

      // Validate and fix
      const result = validateAndFix(content, allModuleIds);

      if (!result.valid) {
        continue; // retry
      }

      // Build SemanticZoomLevel from validated regions
      const regionModuleMap: Record<string, string[]> = {};
      const regions: Region[] = result.regions.map((r) => {
        const regionId = `region-${r.name.toLowerCase().replace(/\s+/g, '-')}`;
        regionModuleMap[regionId] = r.modules;
        return {
          id: regionId,
          name: r.name,
          moduleCount: r.modules.length,
          loc: estimateLoc(r.modules, graph, dirTree),
        };
      });

      const relationships = deriveRelationships(graph.edges, regionModuleMap);

      return {
        zoomLevel: {
          id: generateId(),
          label: 'Top Level',
          regions,
          relationships,
        },
        regionModuleMap,
      };
    } catch {
      // Network error or other — retry
      continue;
    }
  }

  // All retries exhausted — use fallback
  return { zoomLevel: buildFallback(graph, dirTree), regionModuleMap: {} };
}
