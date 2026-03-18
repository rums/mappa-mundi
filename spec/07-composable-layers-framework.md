# Spec 07: Composable Layers — Framework & Static Analysis Layers

> GitHub Issue: #7
> Dependencies: Spec #1 (DependencyGraph), Spec #3 (DirectoryNode), Spec #4 (SemanticRegion for aggregation)
> Status: ready for TDD

## Intent

Build a composable layer system — overlays that enrich the semantic map with additional data dimensions. Like map overlays for terrain, weather, or traffic. Layers produce per-module scores that aggregate up to region level.

## Scope

### In Scope
- Layer interface and LayerResult/LayerScore data model
- Three concrete static analysis layers:
  1. **TestCoverage** — parse Istanbul/c8 JSON reports → per-module coverage %
  2. **GitStaleness** — days since last git commit per file
  3. **ComplexityHotspots** — flag modules with functions exceeding a configurable LOC threshold
- Two-phase compute: `computeModuleScores()` then `aggregateToRegions(regions)`
- LayerRegistry for discovering and managing available layers
- Per-layer configuration

### Out of Scope
- LLM-based layers (future spec)
- Layer visualization/rendering (that's Spec #9)
- Persistent layer results (computed on demand)

## Data Model

```typescript
interface Layer {
  id: string;
  name: string;
  description: string;
  computeModuleScores(graph: DependencyGraph, dirTree: DirectoryNode, config?: LayerConfig): LayerResult;
  aggregateToRegions(moduleScores: Map<string, LayerScore>, regions: SemanticRegion[]): Map<string, LayerScore>;
}

interface LayerResult {
  layerId: string;
  moduleScores: Map<string, LayerScore>;  // module id → score
}

interface LayerScore {
  value: number;           // always normalized 0-1 (see normalization rules below)
  raw: number;             // original value before normalization
  label: string;           // human-readable, e.g., "85% coverage"
  severity: 'info' | 'warning' | 'critical';
}

interface LayerConfig {
  [key: string]: unknown;  // layer-specific configuration
}

interface LayerRegistry {
  register(layer: Layer): void;
  get(layerId: string): Layer | undefined;
  list(): Layer[];
}
```

## Design Decisions

1. **Two-phase compute**: `computeModuleScores()` produces per-module scores (no SemanticRegion dependency). `aggregateToRegions()` is a separate call, keeping the Layer framework decoupled from Spec #4. Region aggregation can be deferred until regions exist.
2. **Score normalization**: `value` is always 0-1. `raw` preserves the original. Normalization rules:
   - Coverage: raw = percentage (0-100), value = raw/100
   - Staleness: raw = days, value = min(raw/365, 1.0) (capped at 1 year)
   - Complexity: raw = max function LOC in module, value = min(raw/200, 1.0) (capped at 200 LOC)
3. **Severity thresholds** (configurable per layer):
   - Coverage: ≥0.8 → info, ≥0.5 → warning, <0.5 → critical
   - Staleness: ≤90 days → info, ≤180 → warning, >180 → critical
   - Complexity: <50 LOC → info, <100 → warning, ≥100 → critical
4. **Coverage aggregation**: weighted average by module LOC (not simple arithmetic mean). Istanbul provides statement/branch/function/line coverage — use line coverage as the primary metric.
5. **Staleness aggregation**: median of contained files (robust to outliers).
6. **Complexity aggregation**: max severity in region (if any module is critical, region is critical).
7. **Git staleness for untracked files**: raw = 0, severity = info (brand new code).
8. **Coverage path mapping**: normalize both Istanbul paths and ModuleNode.id to relative paths from project root for matching. Modules with no coverage entry get raw = 0, severity = critical (untested code).
9. **Complexity LOC counting**: non-empty lines within function body (consistent with Spec #3's LOC definition). Includes arrow functions, methods, constructors, getters/setters. Nested functions counted independently.

## Acceptance Criteria

1. TestCoverageLayer consumes Istanbul JSON and returns per-module coverage scores
2. Given `login.ts` at 85% and `signup.ts` at 40%, scores attach to correct module IDs
3. Region-level coverage is weighted average by LOC
4. GitStalenessLayer reports days-since-last-commit per file (90 days ago → raw: 90)
5. Region-level staleness is the median of contained files
6. ComplexityLayer flags modules with functions >50 LOC (configurable threshold)
7. All LayerScore values are normalized 0-1 with raw values preserved
8. Severity thresholds are configurable per layer
9. LayerRegistry can register, list, and retrieve layers
10. Layers compute independently — enabling one doesn't affect another
11. Modules with no coverage data get score 0 with severity critical
12. Untracked files get staleness raw=0, severity info

## Test Plan

### Behavior 1: TestCoverageLayer
- Istanbul JSON with 2 modules → correct per-module percentages
- Module not in coverage report → score 0, severity critical
- Coverage report with absolute paths, graph with relative paths → matched correctly
- Empty/malformed coverage report → graceful error, no scores
- Region aggregation: weighted by LOC (not simple average)

### Behavior 2: GitStalenessLayer
- File last modified 90 days ago → raw: 90, value: ~0.25
- File last modified 400 days ago → raw: 400, value: 1.0 (capped)
- Untracked file → raw: 0, severity: info
- Git not available → graceful error, no scores
- Region aggregation: median staleness

### Behavior 3: ComplexityLayer
- Module with 60-line function → flagged, severity warning
- Module with 150-line function → severity critical
- Module with all functions <50 LOC → severity info
- Threshold configurable: set to 30 → more flags
- Region aggregation: max severity in region

### Behavior 4: Score normalization
- Coverage 85% → value: 0.85, raw: 85
- Staleness 90 days → value: ~0.247, raw: 90
- Complexity max 60 LOC → value: 0.3, raw: 60
- All values in 0-1 range

### Behavior 5: LayerRegistry
- Register layer → retrievable by ID
- List returns all registered layers
- Get unknown ID → undefined
- Register duplicate ID → overwrites

### Behavior 6: Two-phase compute
- computeModuleScores works without SemanticRegion data
- aggregateToRegions works with pre-computed module scores
- Region with no modules → no score (excluded from map)

## Implementation Notes

- Layout:
  ```
  src/
    layers/
      types.ts              — Layer, LayerResult, LayerScore, LayerConfig interfaces
      registry.ts           — LayerRegistry implementation
      coverage-layer.ts     — TestCoverageLayer
      staleness-layer.ts    — GitStalenessLayer
      complexity-layer.ts   — ComplexityLayer
  ```
- GitStalenessLayer shells out to `git log --format=%at -- <file>` (batch with `git log --name-only` for performance)
- TestCoverageLayer accepts coverage report path as LayerConfig option
- ComplexityLayer reuses SWC parser from Spec #1 to find function boundaries
