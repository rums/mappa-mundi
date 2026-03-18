import type { ModuleNode, SymbolInfo } from '../types';
import type { SearchResult } from './types';
import { tokenMatch } from './tokenizer';

export function searchSymbols(query: string, modules: ModuleNode[]): SearchResult[] {
  const results: SearchResult[] = [];

  for (const mod of modules) {
    for (const symbol of mod.symbols) {
      const score = tokenMatch(query, symbol.name);
      if (score === 0) continue;

      let relevanceScore: number;
      if (score >= 0.99) {
        // Exact match
        relevanceScore = score;
      } else {
        // Fuzzy match: scale to 0.6-0.9 range
        relevanceScore = 0.6 + score * 0.3;
      }

      // Non-exported symbols get a slight penalty
      if (!symbol.exported) {
        relevanceScore *= 0.9;
      }

      results.push({
        regionId: mod.id,
        moduleId: mod.id,
        relevanceScore,
        explanation: `Symbol '${symbol.name}' matches query '${query}'`,
        matchLayer: 'symbol',
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}
