# Spec 10: Natural Language Search — Semantic Code Location

> GitHub Issue: #10
> Dependencies: Spec #2 (SymbolInfo), Spec #4 (SemanticRegion), Spec #5 (top-level regions)
> Status: ready for TDD

## Intent

Implement natural language search — "where does authentication happen?" — that locates relevant regions and modules on the semantic map using a layered search strategy.

## Scope

### In Scope
- Three-layer search strategy:
  1. **Symbol search** — exact and fuzzy match against symbol names (SymbolInfo from Spec #2)
  2. **Region search** — match against region names and summaries (SemanticRegion from Spec #4)
  3. **LLM-assisted search** — send query + region summaries to LLM for semantic matching
- Ranked, deduplicated results with explanations
- Async/streaming: return Layer 1-2 results immediately, append Layer 3 when available

### Out of Scope
- Map integration (highlight/navigate) — deferred to Spec #8/9 integration
- Search across all zoom levels — search operates on top-level regions and all modules
- Search result caching (LLM results are not cached for v1)
- Search history or suggestions

## Data Model

```typescript
interface SearchResult {
  regionId: string;
  moduleId?: string;       // present for symbol matches
  relevanceScore: number;  // 0-1 normalized
  explanation: string;     // human-readable match reason
  matchLayer: 'symbol' | 'region' | 'llm';
}

interface SearchOptions {
  maxResults?: number;           // default: 20
  enableLLM?: boolean;           // default: true
  escalationThreshold?: number;  // default: 3 (invoke LLM if <3 results from layers 1-2)
}
```

## Design Decisions

1. **Escalation threshold**: LLM search (Layer 3) is invoked when Layers 1-2 return fewer than `escalationThreshold` results (default: 3). Always skipped if `enableLLM: false`.
2. **Fuzzy matching**: use token-based matching. CamelCase and snake_case names are split into tokens (`validateJWT` → `["validate", "JWT"]`). Query is also tokenized. Matching is case-insensitive substring on tokens. Score based on proportion of query tokens matched.
3. **Ranking rules**:
   - Layer 1 exact symbol match: score 1.0
   - Layer 1 fuzzy symbol match: score 0.6-0.9 based on token overlap
   - Layer 2 region name match: score 0.5-0.8 based on token overlap
   - Layer 2 summary match: score 0.3-0.6 based on token overlap
   - Layer 3 LLM match: score 0.4-0.7 (LLM provides its own ranking, normalized)
4. **Deduplication**: if a symbol match and a region match point to the same region, merge into one result. Keep the higher score. Combine explanations.
5. **Search scope**: all modules (for symbol search) and all top-level regions (for region/LLM search). Does NOT recurse into sub-zoom levels.
6. **Non-exported symbols**: included in search (they're captured per Spec #2). May have slightly lower relevance than exported symbols.
7. **LLM integration**: same pattern as Spec #5 — Haiku model, structured JSON response, 2 retries. On LLM failure, return only Layer 1-2 results (no error).
8. **Empty/invalid queries**: empty string or null → return empty results array. No error thrown.
9. **Result limit**: return at most `maxResults` results, sorted by relevanceScore descending.

## Acceptance Criteria

1. Query "where does auth happen" matches region named "Authentication System" with relevanceScore ≥ 0.5
2. Query "JWT validation" matches module exporting `validateJWT()` via symbol search
3. Exact symbol matches rank above fuzzy region name matches
4. When layers 1-2 return <3 results, LLM search is invoked
5. Query matching nothing at all returns empty array (not an error)
6. Each result includes a non-empty `explanation` describing the match reason
7. Results are deduplicated — same region doesn't appear twice
8. Results are sorted by relevanceScore descending, capped at maxResults
9. LLM failure → return Layer 1-2 results only (no error propagated)
10. Empty string query → empty results array
11. CamelCase symbol names are tokenized for matching: "validateJWT" findable by "validate" or "JWT"

## Test Plan

### Behavior 1: Symbol search (Layer 1)
- Exact match: query "validateJWT" → module with validateJWT(), score ~1.0
- Token match: query "validate" → matches validateJWT with lower score
- CamelCase split: "JWT" matches "validateJWT"
- Case insensitive: "validatejwt" matches "validateJWT"
- No symbol matches → empty from this layer
- Non-exported symbol matches (lower relevance)

### Behavior 2: Region search (Layer 2)
- Query "auth" matches "Authentication System" region name
- Query "handles user login" matches region summary containing similar text
- Case insensitive matching
- Multiple regions partially match → all returned, ranked
- No region matches → empty from this layer

### Behavior 3: LLM search (Layer 3)
- Layers 1-2 return 0 results → LLM invoked
- Layers 1-2 return 2 results (< threshold 3) → LLM invoked
- Layers 1-2 return 5 results → LLM NOT invoked
- LLM fails → Layer 1-2 results returned without error
- enableLLM: false → LLM never invoked

### Behavior 4: Ranking and deduplication
- Symbol match (0.9) outranks region match (0.6) for different regions
- Same region found by symbol and region search → merged, higher score kept
- Merged result explanation combines both match reasons
- Results sorted descending by score
- Capped at maxResults

### Behavior 5: Edge cases
- Empty query → empty array
- Very long query → handled (truncated for LLM prompt if needed)
- Special characters in query → no crash
- Project with no regions → empty array
- Project with no modules → empty array (symbol search skipped)

### Behavior 6: Explanations
- Symbol match: "Matched exported symbol 'validateJWT' in src/auth/jwt.ts"
- Region match: "Region name 'Authentication System' matches query"
- LLM match: explanation from LLM response
- Merged result: combined explanation

## Implementation Notes

- Entry point: `search(query: string, modules: ModuleNode[], regions: SemanticRegion[], options?: SearchOptions): Promise<SearchResult[]>`
- LLMClient injected for testability
- Token splitting: `splitTokens(name: string): string[]` — split on camelCase, snake_case, hyphens
- Layout:
  ```
  src/
    search/
      index.ts          — main search orchestrator
      symbol-search.ts  — Layer 1: symbol matching
      region-search.ts  — Layer 2: region name/summary matching
      llm-search.ts     — Layer 3: LLM-assisted search
      tokenizer.ts      — name tokenization and matching utilities
      types.ts          — SearchResult, SearchOptions
  ```
