import type { SemanticRegion } from '../semantic-zoom';
import type { SearchResult } from './types';
import { splitTokens, tokenMatch } from './tokenizer';

const STOP_WORDS = new Set([
  'where', 'does', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'how', 'what', 'when', 'which', 'who', 'why',
  'do', 'did', 'has', 'have', 'had', 'be', 'been', 'being', 'are', 'was',
  'were', 'it', 'its', 'this', 'that', 'these', 'those', 'happen', 'happens',
  'go', 'goes', 'get', 'gets',
]);

function extractMeaningfulTokens(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = words.filter(w => !STOP_WORDS.has(w));
  // If all words were stop words, use original words
  return meaningful.length > 0 ? meaningful : words;
}

function substringMatch(query: string, text: string): number {
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  if (tLower.includes(qLower)) return 1;
  return 0;
}

function computeNameScore(query: string, regionName: string): number {
  const meaningfulTokens = extractMeaningfulTokens(query);

  // Try token match with each meaningful token against region name
  let bestScore = 0;

  for (const token of meaningfulTokens) {
    // Check substring match against name
    const sub = substringMatch(token, regionName);
    if (sub > 0) {
      bestScore = Math.max(bestScore, 1.0);
      continue;
    }
    // Check token-level match
    const nameTokens = splitTokens(regionName);
    const nameLower = nameTokens.map(t => t.toLowerCase());
    const tokenLower = token.toLowerCase();
    for (const nt of nameLower) {
      if (nt.includes(tokenLower) || tokenLower.includes(nt)) {
        bestScore = Math.max(bestScore, 0.8);
      }
    }
  }

  // Also try full token match
  const fullQuery = meaningfulTokens.join(' ');
  const tmScore = tokenMatch(fullQuery, regionName);
  bestScore = Math.max(bestScore, tmScore);

  return bestScore;
}

function computeSummaryScore(query: string, summary: string): number {
  const meaningfulTokens = extractMeaningfulTokens(query);
  const summaryWords = summary.toLowerCase().split(/\s+/).filter(Boolean);

  let matched = 0;
  for (const token of meaningfulTokens) {
    const tokenLower = token.toLowerCase();
    if (summaryWords.some(sw => sw.includes(tokenLower) || tokenLower.includes(sw))) {
      matched++;
    }
  }

  if (meaningfulTokens.length === 0) return 0;
  return matched / meaningfulTokens.length;
}

export function searchRegions(query: string, regions: SemanticRegion[]): SearchResult[] {
  const results: SearchResult[] = [];

  for (const region of regions) {
    const rawNameScore = computeNameScore(query, region.name);
    const rawSummaryScore = computeSummaryScore(query, region.summary);

    // Scale name matches to 0.5-0.8, summary matches to 0.3-0.6
    const nameScore = rawNameScore > 0 ? 0.5 + rawNameScore * 0.3 : 0;
    const summaryScore = rawSummaryScore > 0 ? 0.3 + rawSummaryScore * 0.3 : 0;

    const bestScore = Math.max(nameScore, summaryScore);
    if (bestScore === 0) continue;

    let explanation: string;
    if (nameScore >= summaryScore) {
      explanation = `Region '${region.name}' name matches query '${query}'`;
    } else {
      explanation = `Region '${region.name}' summary matches query '${query}'`;
    }

    results.push({
      regionId: region.id,
      relevanceScore: bestScore,
      explanation,
      matchLayer: 'region',
    });
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}
