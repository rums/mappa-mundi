# Spec 04: Semantic Zoom — Data Model & Cache Layer

> GitHub Issue: #4
> Dependencies: Spec #1 (ModuleNode.id), Spec #2 (SymbolInfo), Spec #3 (DirectoryNode)
> Status: ready for TDD

## Intent

Define the multi-level semantic zoom data model and a cache layer that stores LLM-generated interpretations. The cache supports partial invalidation — when code changes in one subsystem, only that subsystem's cached zoom levels are invalidated.

## Scope

### In Scope
- SemanticMap top-level container type
- SemanticRegion, SemanticRelationship, SemanticZoomLevel data model
- ZoomCache interface and in-memory implementation
- Cache keying by (projectId, path, depth)
- Content-hash-based invalidation with per-region granularity
- Partial invalidation (sibling regions survive)
- Parent invalidation (parent zoom levels invalidated when children change)
- TTL with stale-while-revalidate semantics
- JSON round-trip serialization

### Out of Scope
- Persistent cache storage (filesystem/database) — in-memory for v1
- LLM invocation (that's Specs #5 and #6)
- Cache warming or precomputation strategies

## Data Model

```typescript
interface SemanticMap {
  projectId: string;          // unique project identifier
  projectRoot: string;        // absolute path
  rootZoom: SemanticZoomLevel; // top-level view
  generatedAt: string;        // ISO timestamp
}

interface SemanticZoomLevel {
  path: string;               // what area this zoom covers (e.g., "src/")
  depth: number;              // 0 = project overview, 1 = subsystem, 2+ = deeper
  regions: SemanticRegion[];
  relationships: SemanticRelationship[];
  sourceHash: string;         // hash of structural input that produced this level
  generatedAt: string;        // ISO timestamp
}

interface SemanticRegion {
  id: string;                 // stable identifier
  name: string;               // LLM-generated, e.g., "Authentication System"
  summary: string;            // LLM-generated description
  modules: string[];          // ModuleNode.id references (from Spec #1)
  directories: string[];      // DirectoryNode.path references (from Spec #3)
  regionHash: string;         // hash of this region's structural data (for partial invalidation)
  childZoom?: SemanticZoomLevel; // next zoom level (null until loaded)
}

interface SemanticRelationship {
  source: string;             // region id
  target: string;             // region id
  kind: 'depends-on' | 'data-flow' | 'extends' | 'uses';
  edgeCount: number;          // number of underlying import edges
  description?: string;       // optional LLM-generated description
}
```

## Cache Interface

```typescript
interface CacheResult {
  level: SemanticZoomLevel;
  stale: boolean;             // true if TTL expired but data still available
}

interface ZoomCache {
  get(projectId: string, path: string, depth: number): CacheResult | null;
  set(projectId: string, path: string, depth: number, level: SemanticZoomLevel, ttlMs?: number): void;
  invalidateByPath(projectId: string, pathPrefix: string): number;  // returns count invalidated
  invalidateByHash(projectId: string, path: string, depth: number, currentSourceHash: string): boolean;  // true if invalidated
  clear(projectId: string): void;
}
```

## Design Decisions

1. **SemanticMap is the top-level container**: wraps project metadata + root zoom level. This is what gets serialized/returned to clients.
2. **sourceHash computation**: hash of the serialized DependencyGraph edges + DirectoryNode metrics scoped to the region's directories. Computed by the caller (Specs #5/#6), not by the cache itself.
3. **regionHash per region**: each SemanticRegion carries its own hash of its constituent modules' structural data. This enables partial invalidation — only regions whose regionHash changed need regeneration.
4. **Parent invalidation cascade**: when a child region changes, parent zoom levels are also invalidated (their summaries may reference the changed subsystem). Siblings are NOT invalidated.
5. **TTL semantics**: stale-while-revalidate. `get()` returns stale data with `stale: true` flag. Caller decides whether to serve stale data or trigger refresh. Hash-invalidated entries are removed entirely (not served stale).
6. **childZoom is nullable**: starts as `null`/`undefined`, populated on demand when user zooms in. This is the lazy-loading mechanism.
7. **In-memory cache for v1**: simple Map-based. Interface is defined so persistent implementations can be swapped in later.

## Acceptance Criteria

1. A SemanticMap with 3 top-level regions serializes to JSON and deserializes back identically
2. `cache.get()` returns `null` on cache miss
3. After `cache.set()`, `cache.get()` with same key returns the stored level with `stale: false`
4. Same path but different depth is a cache miss
5. After TTL expiration, `cache.get()` returns the level with `stale: true`
6. `invalidateByHash()` removes the entry when sourceHash doesn't match — subsequent `get()` returns `null`
7. `invalidateByPath("src/auth")` invalidates `src/auth` zoom but NOT `src/api` zoom
8. `invalidateByPath("src/auth")` also invalidates the parent `src/` zoom (cascade up)
9. The model supports 3+ zoom levels: depth 0 (overview) → depth 1 (subsystem) → depth 2 (module detail)
10. Empty SemanticMap (0 regions) serializes correctly
11. `cache.clear(projectId)` removes all entries for that project

## Test Plan

### Behavior 1: Data model serialization
- 3 regions with relationships → JSON round-trip
- Nested childZoom (3 levels deep) → round-trip
- Empty map, empty regions → round-trip
- Unicode in region names/summaries → round-trip
- Large model (20 regions, 3 levels) → round-trip

### Behavior 2: Cache hit/miss
- Set then get → hit with stale: false
- Get without set → null
- Same path, different depth → miss
- Same path and depth, different projectId → miss
- Path normalization: "src/" vs "src" → consistent

### Behavior 3: TTL and staleness
- Set with TTL, get before expiry → stale: false
- Set with TTL, get after expiry → stale: true, data still returned
- Set with no TTL → never stale (unless hash-invalidated)
- TTL of 0 → immediately stale

### Behavior 4: Hash-based invalidation
- Set entry, invalidate with different hash → entry removed (get returns null)
- Set entry, invalidate with same hash → entry NOT removed
- File added to region → hash changes → invalidated
- File modified → hash changes → invalidated

### Behavior 5: Partial invalidation by path
- 3 sibling paths cached → invalidate one → other two survive
- Invalidate child → parent also invalidated
- Invalidate child → sibling children survive
- Deeply nested invalidation propagates up to root
- Returns count of invalidated entries

### Behavior 6: Multi-level zoom model
- Depth 0: 4 regions covering entire project
- Depth 1: one region expanded to 5 sub-regions
- Depth 2: one sub-region showing individual modules
- childZoom starts null, populated after zoom
- Regions at different depths reference correct module IDs
