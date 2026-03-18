import type { ModuleNode } from '../types';
import type { SemanticRegion } from '../semantic-zoom';
import type { SearchResult, SearchOptions } from './types';
import type { LLMClient } from './llm-search';
import { searchSymbols } from './symbol-search';
import { searchRegions } from './region-search';
import { searchWithLLM } from './llm-search';

export async function search(
  query: string,
  modules: ModuleNode[],
  regions: SemanticRegion[],
  options: SearchOptions,
  llm: LLMClient,
): Promise<SearchResult[]> {
  if (!query || !query.trim()) return [];

  const maxResults = options.maxResults ?? 20;
  const enableLLM = options.enableLLM ?? true;
  const escalationThreshold = options.escalationThreshold ?? 3;

  // Layer 1: Symbol search
  const symbolResults = searchSymbols(query, modules);

  // Map symbol results to region IDs based on region.modules membership
  for (const sr of symbolResults) {
    if (sr.moduleId) {
      const matchingRegion = regions.find(r => r.modules.includes(sr.moduleId!));
      if (matchingRegion) {
        sr.regionId = matchingRegion.id;
      }
    }
  }

  // Layer 2: Region search
  const regionResults = searchRegions(query, regions);

  // Combine
  let combined = [...symbolResults, ...regionResults];

  // LLM escalation
  if (enableLLM && combined.length < escalationThreshold) {
    const llmResults = await searchWithLLM(query, regions, llm);
    combined = [...combined, ...llmResults];
  }

  // Deduplicate by regionId: keep higher score, combine explanations
  const deduped = new Map<string, SearchResult>();
  for (const result of combined) {
    const existing = deduped.get(result.regionId);
    if (!existing) {
      deduped.set(result.regionId, { ...result });
    } else {
      if (result.relevanceScore > existing.relevanceScore) {
        const combinedExplanation = existing.explanation !== result.explanation
          ? `${result.explanation}; ${existing.explanation}`
          : result.explanation;
        deduped.set(result.regionId, {
          ...result,
          explanation: combinedExplanation,
        });
      } else {
        if (result.explanation !== existing.explanation) {
          existing.explanation = `${existing.explanation}; ${result.explanation}`;
        }
      }
    }
  }

  const results = Array.from(deduped.values());

  // Sort by score descending
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Cap at maxResults
  return results.slice(0, maxResults);
}
