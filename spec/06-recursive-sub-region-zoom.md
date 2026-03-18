# Spec 06: LLM Interpretation — Recursive Sub-Region Zoom

> GitHub Issue: #6
> Dependencies: Spec #4 (cache layer, data model), Spec #5 (top-level clustering, LLM patterns)
> Status: ready for TDD

## Intent

When a user zooms into a semantic region, use an LLM to break that region into 3-7 sub-regions on demand. This is the recursive zoom — generating deeper detail levels of the semantic map. Below a threshold, show individual module detail instead of further clustering.

## Scope

### In Scope
- LLM prompt construction for sub-region clustering (inherits patterns from Spec #5)
- Recursion termination: regions with <5 modules show module-level detail
- Max recursion depth guard
- Cache integration via Spec #4's ZoomCache
- Parent context propagation (parent summary in prompt)
- Fallback on LLM failure (subdirectory grouping, then alphabetical)
- Sub-region relationship generation (scoped to siblings only)
- Response validation against SemanticZoomLevel schema

### Out of Scope
- Top-level clustering (that's Spec #5)
- Cache implementation (that's Spec #4)
- Frontend zoom interaction (that's Spec #8)

## Design Decisions

1. **Same LLM integration pattern as Spec #5**: same LLMClient interface, same retry policy (3 retries, exponential backoff), same schema validation.
2. **Model choice**: same as Spec #5 (Haiku by default, configurable).
3. **Recursion threshold**: `MIN_CLUSTER_SIZE = 5`. Regions with fewer than 5 modules return module-level detail. 5 or more → attempt clustering.
4. **Module-level detail format**: when below threshold, each module becomes a SemanticRegion with `modules: [moduleId]`, `name` = module filename, `summary` = list of exported symbols. No LLM call needed.
5. **Max recursion depth**: `MAX_ZOOM_DEPTH = 5`. At max depth, return module-level detail regardless of module count.
6. **Parent context**: prompt includes the parent region's `name` and `summary` for context continuity. Only immediate parent, not grandparent.
7. **Scoped relationships**: sub-region relationships only reference sibling region IDs. LLM responses with cross-parent references are filtered out.
8. **Fallback strategy**: (a) group by subdirectory within the region, (b) if all modules share one directory, group alphabetically into ceil(N/3) groups, (c) fallback output conforms to SemanticZoomLevel schema.
9. **Recursion safety**: if LLM returns a sub-region containing all parent modules (no progress), treat as failure and fall back. Prevents infinite loops.
10. **Cache on success**: successful zoom results are stored in Spec #4's ZoomCache. Fallback results are also cached (to avoid repeated LLM failures).

## Configuration

```typescript
interface ZoomConfig {
  minClusterSize: number;     // default: 5 — below this, show module detail
  maxZoomDepth: number;       // default: 5 — max recursion depth
  model: string;              // default: "haiku"
  maxRetries: number;         // default: 3
}
```

## Acceptance Criteria

1. Given a region with 15 modules, returns 3-7 sub-regions collectively covering all 15 modules
2. Given a region with 3 modules, returns module-level detail (3 regions, one per module) without LLM call
3. Given a region with exactly 5 modules, attempts LLM clustering (threshold is <5)
4. Second zoom into same region returns cached result without LLM call
5. Sub-region relationships only reference sibling region IDs
6. LLM prompt includes parent region's name and summary
7. On LLM failure (after retries), falls back to subdirectory grouping
8. When all modules share one directory, fallback groups alphabetically
9. At MAX_ZOOM_DEPTH, returns module-level detail regardless of module count
10. LLM returning all modules in one sub-region triggers fallback (no-progress guard)
11. Output conforms to SemanticZoomLevel schema (including fallback output)
12. Fallback results are cached

## Test Plan

### Behavior 1: Sub-region clustering
- 15 modules → 3-7 sub-regions, all modules covered
- Each sub-region has non-empty name and summary
- No orphan modules, no duplicates
- Post-processing fixes orphans/duplicates (same as Spec #5)

### Behavior 2: Module-level detail (below threshold)
- 3 modules → 3 SemanticRegions, one per module, no LLM call
- 4 modules → module-level detail (4 < 5)
- 1 module → single region
- 0 modules → empty regions array (degenerate case)
- Module-level regions have name = filename, summary = exported symbols

### Behavior 3: Threshold boundary
- 5 modules → LLM clustering attempted
- 4 modules → module-level detail
- Configurable threshold respected (set to 3 → 3+ triggers LLM)

### Behavior 4: Cache integration
- Successful zoom → cached in ZoomCache
- Second request → cache hit, no LLM call
- Cache uses correct key: (projectId, regionPath, depth)
- Fallback results also cached

### Behavior 5: Scoped relationships
- Relationships only reference sibling IDs
- LLM response with external references → filtered out
- Self-referential relationship → filtered out
- No relationships between sub-regions → empty array

### Behavior 6: Parent context in prompt
- Prompt contains parent name and summary
- Top-level regions (no grandparent) → parent context from SemanticMap
- Long parent summary → included (not truncated for v1)

### Behavior 7: Fallback behavior
- Network error after retries → subdirectory fallback
- Malformed JSON after retries → subdirectory fallback
- All modules in same directory → alphabetical grouping
- Fallback conforms to SemanticZoomLevel schema
- No-progress guard: all modules in one sub-region → fallback

### Behavior 8: Recursion safety
- MAX_ZOOM_DEPTH reached → module-level detail regardless of count
- LLM returns 1 sub-region with all modules → treated as failure → fallback
- Deep recursion (5 levels) terminates correctly

## Implementation Notes

- Entry point: `zoomIntoRegion(region: SemanticRegion, graph: DependencyGraph, cache: ZoomCache, config?: ZoomConfig): Promise<SemanticZoomLevel>`
- Reuse prompt construction patterns from Spec #5 (`src/interpret/prompt.ts`)
- Add `src/interpret/zoom.ts` for recursive zoom logic
- Add `src/interpret/module-detail.ts` for below-threshold module-level detail
- LLMClient injected for testability
