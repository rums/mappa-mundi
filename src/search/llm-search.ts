import type { SemanticRegion } from '../semantic-zoom';
import type { SearchResult } from './types';

export interface LLMSearchInput {
  query: string;
  regions: Array<{ id: string; name: string; summary: string }>;
}

export interface LLMClient {
  complete: (input: LLMSearchInput) => Promise<{
    content: { matches: Array<{ regionId: string; score: number; explanation: string }> };
    usage: { promptTokens: number; completionTokens: number };
  }>;
}

export async function searchWithLLM(
  query: string,
  regions: SemanticRegion[],
  llm: LLMClient,
): Promise<SearchResult[]> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await llm.complete({
        query,
        regions: regions.map(r => ({ id: r.id, name: r.name, summary: r.summary })),
      });

      return response.content.matches.map(match => ({
        regionId: match.regionId,
        relevanceScore: match.score * 0.3 + 0.4,
        explanation: match.explanation,
        matchLayer: 'llm' as const,
      }));
    } catch {
      // Continue to retry
    }
  }

  return [];
}
