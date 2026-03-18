# Spec 05: LLM Interpretation — Top-Level Concept Clustering

> GitHub Issue: #5
> Dependencies: Spec #1 (DependencyGraph), Spec #2 (SymbolInfo), Spec #3 (DirectoryNode, boundary flags), Spec #4 (SemanticZoomLevel output schema)
> Status: ready for TDD

## Intent

Given structural scanner output, use an LLM to cluster modules into 3-7 high-level conceptual regions — producing the top zoom level (depth 0) of the semantic map. This is the "brain" that turns raw structural data into a human-meaningful map.

## Scope

### In Scope
- Prompt construction from structural data (directory tree, symbols, edges, boundary flags)
- LLM invocation with structured JSON response
- Response validation against SemanticZoomLevel schema
- Fallback to directory-based grouping on LLM failure
- Context window management (truncation for projects up to 500 modules)
- Inter-region relationship derivation from cross-region dependency edges
- Deterministic prompt construction (same input → same prompt)

### Out of Scope
- Recursive zoom (that's Spec #6)
- Cache management (handled by Spec #4's cache layer — this spec produces the data to cache)
- LLM provider selection/configuration (injected as a dependency)

## LLM Integration Contract

```typescript
// Shared interface for LLM calls across Specs #5 and #6
interface LLMClient {
  complete(prompt: string, responseSchema: object): Promise<LLMResponse>;
}

interface LLMResponse {
  content: unknown;    // parsed JSON matching responseSchema
  usage: { promptTokens: number; completionTokens: number };
}

// Config for clustering
interface ClusteringConfig {
  model: string;                // default: "haiku" (fast, cheap)
  maxRetries: number;           // default: 3
  maxRegions: number;           // default: 7
  minRegions: number;           // default: 3
  maxPromptTokens: number;      // default: context window - 4096 (reserve for response)
}
```

## Design Decisions

1. **Model choice**: use Haiku (fast, cheap) for initial clustering. Model is configurable via ClusteringConfig.
2. **Prompt determinism**: all inputs sorted by stable key (directory path, module ID, edge source+target) before prompt construction. Same structural input → byte-identical prompt.
3. **Response format**: LLM returns JSON matching a specified schema. Schema is a simplified version of SemanticZoomLevel (regions with names, summaries, module lists). The caller transforms it into a full SemanticZoomLevel with hashes and timestamps.
4. **Retry policy**: up to 3 retries with exponential backoff (1s, 2s, 4s). Retry on: network errors, malformed JSON, schema validation failure. After all retries exhausted → fallback.
5. **Fallback**: one region per top-level directory. Region name = directory basename, title-cased. Summary = "Contains N modules". Relationships derived from cross-directory edges.
6. **Truncation priority** (when prompt exceeds context window): cut in order: (1) per-module symbol details, (2) internal dependency edges within directories, (3) directory metrics — preserving cross-directory edges and directory names last.
7. **Validation post-processing**: after LLM response, verify every input module appears in exactly one region. If modules are missing, assign them to the nearest region (by directory proximity). If duplicated, keep only the first assignment.
8. **Relationship derivation**: after clustering, aggregate cross-region ImportEdges into SemanticRelationships. `edgeCount` = number of underlying edges. `kind` defaults to `depends-on`; LLM may optionally classify.
9. **Region count enforcement**: if LLM returns <3 or >7 regions, retry with an adjusted prompt emphasizing the constraint. After retries, accept whatever valid grouping was returned (even 2 or 8 regions).

## Acceptance Criteria

1. Given a project with `auth/`, `api/`, `db/`, `ui/` directories, returns 3-7 named regions each covering at least one directory
2. Every module in the input appears in exactly one region (no orphans, no duplicates)
3. Output conforms to SemanticZoomLevel schema (Spec #4) — serializable and valid
4. On LLM failure (after retries), falls back to directory-based grouping
5. Prompt fits within context window for projects with up to 500 modules
6. Inter-region relationships are generated from cross-region dependency edges with `edgeCount`
7. Deterministic prompt: same structural input produces identical prompt string
8. Fallback output also conforms to SemanticZoomLevel schema
9. Each region has a non-empty `name` and `summary`
10. Fallback produces one region per top-level directory with name = directory basename

## Test Plan

### Behavior 1: Clustering output
- 4 clear directories → 3-7 named regions
- Each region covers ≥1 directory
- Each region has non-empty name and summary
- Project with 1 directory → 1 region
- Project with 20+ directories → still ≤7 regions (grouped)

### Behavior 2: Module coverage
- All input modules appear in output
- No module in multiple regions
- Post-processing fixes orphaned modules (assigns to nearest region)
- Post-processing fixes duplicates (keeps first assignment)
- Module IDs in output match ModuleNode.id from Spec #1

### Behavior 3: Schema conformance
- Output deserializes to SemanticZoomLevel
- depth = 0, path = project root
- sourceHash and generatedAt populated
- regionHash populated per region

### Behavior 4: Fallback behavior
- Mock LLM returning network error → fallback triggered after retries
- Mock LLM returning malformed JSON → retry then fallback
- Mock LLM returning wrong schema → retry then fallback
- Fallback output: one region per top-level directory
- Fallback conforms to SemanticZoomLevel schema

### Behavior 5: Prompt construction
- Prompt includes directory structure
- Prompt includes key exported symbols per directory
- Prompt includes cross-directory edges
- Prompt includes boundary flags
- Same input → same prompt (sorted, deterministic)
- Large project (500 modules): prompt truncated within token limit
- Truncation removes symbol details first, preserves directory names

### Behavior 6: Relationship derivation
- 10 edges from auth→api modules → one relationship A→B with edgeCount: 10
- Bidirectional: auth→api and api→auth → two relationships
- Internal edges (within same region) → no relationship generated
- Region with no external edges → no relationships
- Isolated region (no edges in or out) → appears with zero relationships

### Behavior 7: Retry behavior
- First LLM call fails, second succeeds → returns second result
- All 3 retries fail → fallback
- Retries use exponential backoff timing

## Implementation Notes

- Entry point: `clusterTopLevel(graph: DependencyGraph, dirTree: DirectoryNode, config?: ClusteringConfig): Promise<SemanticZoomLevel>`
- LLMClient injected as dependency for testability (mock in tests)
- Prompt template versioned as a constant for tracking changes
- Layout:
  ```
  src/
    interpret/
      cluster.ts         — main clustering entry point
      prompt.ts          — prompt construction and truncation
      fallback.ts        — directory-based fallback logic
      validate.ts        — response validation and post-processing
      relationships.ts   — cross-region relationship derivation
  ```
