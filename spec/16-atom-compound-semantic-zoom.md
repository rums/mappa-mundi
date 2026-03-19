# Spec 16: Atom-Compound Semantic Zoom Model

> Dependencies: Spec #1 (DependencyGraph), Spec #3 (DirectoryNode), Spec #5 (top-level clustering patterns)
> Supersedes: Spec #06 (recursive sub-region zoom) — replaces ad-hoc recursion with a monotonicity-guaranteed model
> Status: draft

## Intent

Replace the recursive zoom model (Spec #06) with a principled atom-compound hierarchy that guarantees termination through structural monotonicity. At every zoom level, atoms (the indivisible physical units of the codebase) are grouped into compounds (semantic clusters). Deeper strata refine compounds into strictly smaller compounds over the same atoms. Because atom count per compound strictly decreases and the atom set is finite, the hierarchy necessarily terminates.

## Vocabulary

| Term | Definition |
|------|-----------|
| **Atom** | The indivisible unit of the map. Initially: one file. Future: exported symbol, conceptual unit. The atom set is fixed for a given scan. |
| **Compound** | A named semantic grouping of atoms. Has a name, summary, and an atom membership list. Produced by the two-stage clustering pipeline (structural partitioning → LLM refinement). |
| **Stratum** | One zoom level — a complete partitioning of a parent compound's atoms into child compounds. Strata are numbered from 0 (top). |
| **Map** | The full hierarchy of strata. A tree of compounds, with atoms at the leaves. |
| **Reference** | A cross-compound annotation indicating that a compound semantically relates to atoms it does not own. Not membership — a weighted, directed edge. |
| **Structural partition** | The initial clustering produced by a graph community-detection algorithm (Leiden or Infomap) operating on the dependency graph. Provides a deterministic baseline that the LLM refines. |

## The Monotonicity Invariant

The core guarantee, enforced at validation time:

1. **Partition**: At every stratum, each atom in scope belongs to exactly one compound. No orphans, no duplicates.
2. **Strict subset**: Every compound at stratum N+1 is a subset of exactly one compound at stratum N. A compound's atoms are drawn exclusively from its parent compound's atom set.
3. **Progress**: No compound at stratum N+1 may contain all atoms of its parent compound (that would be a no-op zoom). At least two compounds must result, or the level is a leaf.
4. **Floor**: Below a configurable atom count threshold (`MIN_COMPOUND_SIZE`), no further LLM clustering is attempted. The atoms are displayed directly.

**Termination proof**: Each stratum strictly reduces the maximum atom count per compound. Since atom counts are positive integers, the floor is necessarily reached. Worst case is O(N) strata (each split peels off one atom), though in practice balanced splits yield O(log N) depth. The `maxStratumDepth` safety net caps depth regardless.

**Terminology note**: In the hierarchical clustering literature, "monotonicity" typically refers to merge/split distances increasing through a dendrogram. This spec uses the term to mean **strict refinement** in the partition lattice — each stratum's partition is a refinement of its parent's. The termination argument depends on the strictly-decreasing-integer property, not distance monotonicity.

## Cross-Cutting Concerns: References, Not Membership

Real code doesn't respect clean semantic boundaries. A shared utility atom may be relevant to multiple compounds. The model handles this without breaking the partition invariant:

- Each atom has exactly one **home compound** per stratum (strict partition).
- A compound may declare **weighted references** to atoms outside its membership. These are atoms from sibling compounds that are semantically related (e.g., a shared adapter, a cross-cutting utility).
- Each reference carries a `weight` (0–1) indicating relevance strength — computed from the ratio of dependency edges to that atom vs. the compound's total external edges. This lets the UI distinguish "strongly cross-cutting" from "incidentally referenced" atoms.
- References are annotations for the UI — rendered as ghost/dimmed elements, dependency edges, or tooltips — not as membership. Weight maps naturally to visual intensity (opacity, stroke width).
- The LLM prompt asks for references explicitly: "List any atoms outside this group that are closely related."

This preserves the partition invariant while capturing semantic insight about cross-cutting concerns. Note that `Compound.references` (atom-level annotations) are distinct from `Relationship` (compound-level edges between siblings) — references annotate individual atoms a compound relates to; relationships aggregate dependency edges between compound pairs. The strict-partition-plus-annotations approach is validated by Microsoft GraphRAG's architecture (Leiden partition + LLM community summaries) and by compound graph visualization research, which consistently favors clean partition hierarchies with annotated cross-edges over fuzzy/overlapping membership.

## Data Model

```typescript
/** The indivisible unit — one per file (v1) or per symbol (future) */
interface Atom {
  id: string;            // stable identifier (e.g., module ID from Spec #1)
  label: string;         // human-readable (e.g., filename)
  filePath: string;      // physical location
  metadata?: {           // extensible per atom-type
    loc?: number;
    exportedSymbols?: string[];
  };
}

/** A weighted cross-compound reference annotation */
interface Reference {
  atomId: string;        // atom ID outside this compound
  weight: number;        // 0-1 relevance strength (edge ratio — see "Cross-Cutting Concerns")
}

/** A semantic grouping of atoms at one stratum */
interface Compound {
  id: string;            // deterministic: hash of sorted atomIds (see "ID Generation" below)
  name: string;          // LLM-generated semantic name
  summary: string;       // LLM-generated description
  atomIds: string[];     // atoms owned by this compound (strict membership)
  references: Reference[];  // weighted annotations to atoms outside this compound
  zoomable: boolean;     // false if leaf (below minCompoundSize or at maxStratumDepth)
  doi?: number;          // degree-of-interest score (see "DOI Scoring")
}

/** One zoom level — a partitioning of a parent compound's atoms */
interface Stratum {
  depth: number;         // 0 = top level
  parentCompoundId: string | null;  // null for stratum 0
  compounds: Compound[];
  relationships: Relationship[];    // sibling compound edges only (see "Relationship Scope")
  breadcrumbs: Breadcrumb[];        // denormalized path from root (see "API Contract")
  sourceHash: string;    // hash of structural input (see "Source Hash Computation")
  quality: StratumQuality;          // clustering quality metrics (see "Quality Metrics")
  generatedAt: string;   // ISO timestamp
}
// Stratum lookup key: parentCompoundId ?? "root" (used as cache key and API identifier)

/** Quality metrics computed after stratum generation */
interface StratumQuality {
  mq: number;            // modularization quality: intra-cluster vs inter-cluster edge density (0-1)
  directoryAlignment: number;  // MoJoFM similarity to directory-based grouping (0-100)
  source: 'llm' | 'structural' | 'fallback-directory' | 'fallback-flat';  // how this stratum was produced
}

/** Cross-compound relationship between sibling compounds within one stratum.
 *  v1 derives all relationships as 'depends-on' from ImportEdge data.
 *  'extends' and 'uses' require symbol-level analysis (future — see Spec #2). */
interface Relationship {
  sourceId: string;      // compound ID (must be in this stratum's compounds)
  targetId: string;      // compound ID (must be in this stratum's compounds)
  kind: 'depends-on' | 'extends' | 'uses';
  edgeCount: number;     // underlying atom-level edges
}

/** The full hierarchy (persistence schema — at runtime, strata are loaded lazily) */
interface SemanticMap {
  projectId: string;
  atomType: 'file' | 'symbol';              // what atoms represent in this map
  atoms: Atom[];                              // the complete atom set
  strata: Record<string, Stratum>;           // keyed by parentCompoundId (or "root" for stratum 0)
  generatedAt: string;
}
```

## ID Generation

Stable, deterministic IDs are critical for caching and API references.

**Compound ID**: SHA-256 hash of the sorted `atomIds` array, truncated to 12 hex characters (48 bits), prefixed with `"c-"`. Example: `"c-a1b2c3d4e5f6"`. Because the partition invariant guarantees a unique atom set per compound, this produces stable IDs across LLM runs even when the LLM chooses different names. The human-readable `name` field is for display only. (48 bits gives collision resistance up to ~16M compounds; sufficient for any realistic codebase.)

```typescript
function compoundId(atomIds: string[]): string {
  const sorted = [...atomIds].sort();
  const hash = sha256(sorted.join('\0')).slice(0, 12);
  return `c-${hash}`;
}
```

**Stratum lookup key**: `parentCompoundId ?? "root"` — the compound being zoomed into, or the literal string `"root"` for stratum 0. Since each compound is zoomed at most once, this is unique. This value is used as the cache key and API path parameter; it is not stored as a separate field on the Stratum.

## Source Hash Computation

The `sourceHash` determines cache invalidation. It is a SHA-256 hash of the stratum's structural inputs:

```typescript
function sourceHash(atomsInScope: Atom[], edgesInScope: ImportEdge[]): string {
  const atomPart = atomsInScope
    .map(a => `${a.id}:${a.filePath}:${a.metadata?.loc ?? 0}:${(a.metadata?.exportedSymbols ?? []).sort().join(',')}`)
    .sort()
    .join('\n');
  const edgePart = edgesInScope
    .map(e => `${e.source}->${e.target}`)
    .sort()
    .join('\n');
  return sha256(`${atomPart}\n---\n${edgePart}`);
}
```

This means a stratum invalidates when: files are added/removed, file paths change, LOC changes, exported symbols change, or import edges change. Pure content changes that don't affect LOC, exports, or edges do not invalidate.

## Relationship Scope

Within a stratum, `relationships` are edges **between sibling compounds only**. When zooming into compound A to produce sub-compounds A1, A2, A3:

- Relationships are computed from atom-level `ImportEdge`s where source atom ∈ Ai and target atom ∈ Aj (i ≠ j).
- When multiple atom-level edges exist between the same compound pair, they are aggregated into a single `Relationship` with `kind: 'depends-on'` and `edgeCount` equal to the total number of underlying edges. (v1 derives all relationships as `'depends-on'` from import edges. Richer kinds like `'extends'` and `'uses'` require symbol-level analysis from Spec #2 to determine whether an import is used in an `extends` clause, as a type reference, etc.)
- Edges to atoms outside compound A (i.e., in sibling compounds B, C) are **not** included in this stratum's relationships — they are captured at the parent stratum level.
- This keeps each stratum self-contained: relationships describe internal structure, not external context.

## Quality Metrics

Every stratum records quality metrics on its `StratumQuality` object, computed after generation:

### Modularization Quality (MQ)

MQ measures structural coherence: the ratio of intra-compound edges to total edges, penalized for inter-compound coupling. For a stratum with compounds C₁…Cₖ:

```
MQ = (1/k) × Σᵢ [ intra(Cᵢ) / (intra(Cᵢ) + ½ × inter(Cᵢ)) ]
```

where `intra(Cᵢ)` counts dependency edges between atoms within Cᵢ, and `inter(Cᵢ)` counts edges from atoms in Cᵢ to atoms outside Cᵢ. MQ ranges from 0 (all edges cross compound boundaries) to 1 (no inter-compound edges). MQ > 0.5 indicates structurally coherent compounds.

MQ is cheap to compute from the dependency graph and requires no ground truth. It is the primary quality signal.

### Directory Alignment

MoJoFM similarity between the LLM partition and a directory-based partition (grouping atoms by immediate subdirectory). Ranges from 0 (completely different) to 100 (identical).

**Interpretation**: moderate alignment (40–80) is ideal. Below 40 suggests the LLM is ignoring developer-intended organization. Above 80 suggests the LLM is merely reproducing folder structure — in which case the LLM adds little value and the structural partition alone may suffice.

### Source Tracking

The `quality.source` field records how the stratum was produced: `'llm'` for the full two-stage pipeline, `'structural'` for Leiden-only fallback, `'fallback-directory'` for directory grouping, or `'fallback-flat'` for flat split. This enables monitoring of LLM reliability and fallback rates.

## DOI Scoring

Each compound receives a **degree-of-interest** (DOI) score (Furnas 1986, extended by Card & Nation 2002) combining intrinsic importance with navigation context:

```
DOI(compound) = IntrinsicInterest(compound) + ProximityToFocus(compound)
```

**Intrinsic interest** is computed from static properties — normalized atom count, aggregate code complexity, and recent churn (commit frequency). Compounds containing more code, more complex code, or more actively changing code score higher. Normalized to [0, 1]:

```
IntrinsicInterest = 0.5 × (atomCount / maxAtomCountInStratum)
                  + 0.3 × (avgComplexity / maxComplexityInStratum)
                  + 0.2 × (churnScore / maxChurnInStratum)
```

where each component is 0 when the metric is unavailable (e.g., no churn data on first scan). Weights are tunable but these defaults favor size — larger compounds are more likely to benefit from pre-fetching.

**Proximity to focus** is computed at request time based on graph distance in the hierarchy from the user's current focus compound. Decays exponentially:

```
ProximityToFocus = 0                              // no focus set
                 | 1.0                            // the focus compound itself
                 | 0.6                            // parent or immediate children
                 | 0.3                            // siblings (same parent)
                 | 0                              // everything else
```

DOI drives two behaviors:
1. **Pre-fetching**: the frontend speculatively loads strata for high-DOI compounds, reducing perceived latency.
2. **Visual emphasis**: high-DOI compounds can be rendered larger, brighter, or with thicker borders to guide attention.

DOI is stored on the `Compound.doi` field and updated on each zoom interaction. It is advisory — it does not affect the partition or hierarchy.

## Atom Resolution

The atom set is computed once per scan and is immutable for the lifetime of the map:

**v1 — File atoms**: One atom per module in the DependencyGraph. `atom.id = ModuleNode.id`. This is cheap and already available from Spec #1.

**Future — Symbol atoms**: One atom per exported symbol. Richer semantic signal, better for small-to-medium codebases. Requires Spec #2 symbol extraction.

**Future — Derived atoms**: Conceptual units identified by a pre-pass (e.g., "the auth middleware chain"). Most expensive, richest signal.

The atom type is recorded on the SemanticMap so the UI knows what granularity it's displaying.

## Two-Stage Clustering Pipeline

Each stratum is produced by a two-stage pipeline: **structural partitioning** followed by **LLM refinement**. This hybrid approach combines the determinism and formal guarantees of graph algorithms with the semantic understanding of LLMs.

### Stage 1: Structural Partition (Leiden / Infomap)

Run a community-detection algorithm on the dependency subgraph for the atoms in scope:

1. **Build subgraph**: extract the directed dependency graph restricted to the current atom set.
2. **Run Leiden** (preferred) or **Infomap** (for strongly directed graphs where random-walk dynamics better capture information flow). Leiden's resolution parameter is tuned to target the desired cluster count range (3–7 for stratum 0, 2–5 for deeper strata).
3. **Output**: a strict partition of atoms into structurally coherent communities. No names, no summaries — just atom-to-cluster assignments.

Leiden guarantees well-connected communities (Traag et al., 2019) — unlike Louvain, which can produce disconnected clusters. The partition satisfies the monotonicity invariant by construction when applied recursively.

**Why not LLM-only?** Three reasons:
- **Determinism**: the structural partition is reproducible. LLM output is not.
- **Speed**: Leiden runs in milliseconds vs. seconds for an LLM call.
- **Better fallback**: when the LLM is unavailable, a Leiden partition is dramatically better than directory-based grouping — it respects dependency structure. (Directory grouping becomes the tertiary fallback.)

### Stage 2: LLM Refinement

The LLM receives the structural partition as a **suggestion** and may:
- **Accept** the partition as-is and add names + summaries.
- **Adjust** by moving atoms between clusters (splitting or merging groups) based on semantic understanding that dependency structure alone misses.
- **Name and summarize** each compound with human-readable labels.
- **Annotate references** to atoms in sibling compounds that are semantically related.

The LLM's adjustments are still subject to full validation (see "Validation & Post-Processing"). The structural partition provides a strong starting point; the LLM adds semantic value on top.

This architecture is validated by Microsoft GraphRAG (hierarchical Leiden → LLM community summarization) and by SemArc (IEEE 2025), which showed LLM-augmented architecture recovery outperforms purely structural methods by 32 percentage points.

### When to Skip Stage 1

- **Small atom sets** (< 12 atoms): Leiden adds little value when the LLM can easily reason about the full set. Skip directly to LLM clustering.
- **Stage 1 failure**: if the dependency graph is disconnected or has no edges (e.g., a set of unrelated utility files), Leiden degenerates. Fall through to LLM-only clustering.

## LLM Prompt Design

### Stratum 0 (Top-Level)

The prompt provides the structural partition as a starting point. The LLM may accept it or adjust:

```
You are analyzing a codebase with {N} atoms (files).
Group these atoms into 3-7 compounds — high-level semantic regions.

Atoms:
{sorted atom list with paths, LOC, exported symbols}

Dependencies:
{cross-atom edges}

Suggested grouping (from dependency structure analysis):
{structural partition from Stage 1, formatted as: Group 1: [atom-1, atom-2], Group 2: [atom-3, atom-4], ...}

The suggested grouping is based on dependency structure alone. You may accept it, merge groups,
split groups, or move atoms between groups based on your semantic understanding of the code.

Example:
Given atoms for a web app — auth.ts, jwt.ts, db.ts, queries.ts, user-model.ts, logger.ts
Suggested grouping: [auth.ts, jwt.ts, logger.ts], [db.ts, queries.ts, user-model.ts]

Good output (logger.ts moved — it's cross-cutting, not auth-specific):
{
  "compounds": [
    {"name": "Authentication", "summary": "Login and token management",
     "atomIds": ["auth.ts", "jwt.ts"], "references": ["logger.ts"]},
    {"name": "Data Access", "summary": "Database connectivity and query execution",
     "atomIds": ["db.ts", "queries.ts"], "references": []},
    {"name": "Domain & Infrastructure", "summary": "Core models and shared utilities",
     "atomIds": ["user-model.ts", "logger.ts"], "references": []}
  ]
}

Return JSON:
{
  "compounds": [
    {
      "name": "Human-Readable Name",
      "summary": "What this compound represents",
      "atomIds": ["atom-1", "atom-2", ...],
      "references": ["atom-9"]  // atoms from other compounds that relate
    }
  ]
}

Rules:
- Every atom must appear in exactly one compound's atomIds.
- References are atoms NOT in this compound's atomIds that are closely related.
- 3-7 compounds total.
- Think step-by-step about which atoms belong together semantically before producing your grouping.
```

### Stratum N+1 (Zoom Into Compound)

```
You are refining compound "{parentName}" ({M} atoms).
Parent summary: "{parentSummary}"

Zoom path (from project root to here):
  → {stratum0CompoundName} → {stratum1CompoundName} → ... → {parentName}

Atoms in this compound:
{sorted atom list, scoped to parent's atomIds}

Internal dependencies:
{edges between these atoms only}

Related atoms outside this compound (for reference context):
{parent compound's references, if any — atom ID and label}

Suggested sub-grouping (from dependency structure analysis):
{structural partition of this compound's atoms, or "No structural suggestion available" if skipped}

The suggested grouping is based on internal dependency structure. You may accept, adjust,
or override it based on your semantic understanding of how these atoms relate within {parentName}.

Group these {M} atoms into 2-5 sub-compounds.

Think step-by-step: what are the distinct responsibilities within {parentName}? Do the suggested
groups align with those responsibilities, or should atoms be moved?

Return JSON:
{
  "compounds": [
    {
      "name": "Sub-Compound Name",
      "summary": "What this sub-compound does within {parentName}",
      "atomIds": ["atom-3", "atom-4"],
      "references": ["atom-1"]
    }
  ]
}

Rules:
- Every atom listed above must appear in exactly one compound's atomIds.
- Do NOT include atoms not listed above in atomIds.
- References may point to any atom in the project (for cross-cutting concerns).
- 2-5 compounds total.
```

### Breadcrumb Context

The prompt includes the full zoom path — the chain of compound names from stratum 0 down to the current zoom target. This prevents the LLM from drifting back to top-level concepts or producing categories that belong to sibling compounds. The zoom path is read from the stratum's denormalized `breadcrumbs` field (written at stratum creation time from the parent path + current compound). This avoids needing to load ancestor strata from cache at prompt-construction time.

### External Edge Context

The zoom prompt provides the parent compound's `references` for cross-cutting context. It does *not* include atoms from sibling compounds that have edges into this compound — that context is available in the parent stratum's `relationships` but is omitted from the prompt to keep token cost bounded. A future refinement could include a summary of inbound edges from siblings (e.g., "5 atoms in 'Networking' depend on atoms in this compound").

### Atom List Formatting

Each atom in the prompt is formatted as:
```
  {atom.id}  {atom.filePath}  (LOC: {atom.metadata.loc ?? "?"}, exports: {atom.metadata.exportedSymbols?.join(", ") ?? "none"})
```
When metadata fields are absent, use placeholder text rather than omitting — this keeps the format predictable for the LLM.

## Validation & Post-Processing

After every LLM response, enforce the invariant mechanically:

1. **Parse**: JSON parse with schema check. On failure → retry (up to `maxRetries`). **Infrastructure errors** (network timeout, rate limit, LLM unavailable) also consume a retry, but on the first infrastructure error the system should wait with exponential backoff (1s, 4s) before retrying. If all retries are exhausted by infrastructure errors alone (no parse was ever attempted), proceed directly to fallback — do not count an infrastructure failure as evidence that the LLM "can't cluster" these atoms.
2. **Partition check**: every in-scope atom appears in exactly one compound's `atomIds`.
   - **Missing atoms**: assign to nearest compound by directory proximity (same as Spec #5).
   - **Duplicate atoms**: keep first assignment, remove from later compounds.
   - **Out-of-scope atoms in atomIds**: move to references (the LLM tried to borrow — redirect to annotation).
3. **Progress check**: if only one compound is returned containing all atoms, treat as failure → retry (up to `maxRetries`). After all retries exhausted → fallback.
4. **Reference validation**: reference `atomId`s must point to valid atom IDs. Unknown IDs are silently dropped. References that duplicate an atom already in the compound's `atomIds` are also dropped. Weights are computed post-validation from actual dependency edge ratios (the LLM provides atom IDs only; weights are mechanically derived).
5. **Compound count**: if outside the requested range (2-5 for zoom, 3-7 for top), accept but log. Do not retry just for count.
6. **Assign `zoomable`**: set `compound.zoomable = atomIds.length >= minCompoundSize && depth + 1 < maxStratumDepth`.
7. **Assign `id`**: compute `compound.id` from sorted `atomIds` (see "ID Generation").
8. **Compute reference weights**: for each validated reference, compute weight as the number of dependency edges from the compound's atoms to that reference atom, divided by the compound's total external edge count. Drop references with weight 0 (no actual dependency connection — LLM hallucinated the relationship).
9. **Compute quality metrics**: calculate MQ from the dependency graph, directory alignment via MoJoFM, and record the source (see "Quality Metrics").

The validator is the safety net. The LLM can be creative; the validator enforces the invariant.

## Termination Rules

```typescript
interface ZoomConfig {
  minCompoundSize: number;   // default: 6 — minimum for a meaningful 2-way split (3+3)
  maxStratumDepth: number;   // default: 5 — absolute depth limit as safety net
  maxRetries: number;        // default: 2 — retries per stratum on parse or progress failure
}
```

A compound becomes a **leaf** (no further zoom available, `zoomable = false`) when any of:
- `atomIds.length < minCompoundSize` — too few atoms to meaningfully subdivide (6 is the minimum that can split into two non-trivial groups of 3)
- `depth >= maxStratumDepth` — safety net reached
- LLM returns a single compound after all retries exhausted → fallback applied → if fallback also yields a single group → mark as leaf

**Small project shortcut**: if the total atom count is less than `minCompoundSize`, stratum 0 emits a single compound containing all atoms, marked as a leaf. No LLM call is made.

At leaf compounds, the UI shows individual atoms directly (filename, symbols, metrics).

## Fallback Strategy

On LLM failure (after retries), a tiered hierarchy of fallbacks:

1. **Structural partition** (from Stage 1): if the Leiden/Infomap partition produced ≥2 clusters, use it directly. Name compounds by their most common subdirectory or a generic label ("Group A", "Group B"). This is the strongest fallback — it respects dependency structure and produces well-connected communities. Mark `quality.source = 'structural'`.
2. **Directory grouping**: group atoms by their immediate subdirectory within the compound's scope. One sub-compound per subdirectory. If this produces ≥2 sub-compounds, use it. Mark `quality.source = 'fallback-directory'`.
3. **Flat split**: if all atoms share one directory (or directory grouping produced only 1 group), sort atoms by filename and split into `ceil(N / minCompoundSize)` groups distributed as evenly as possible. E.g., with `minCompoundSize = 6`: 7 atoms → [4, 3], 13 atoms → [5, 4, 4]. This keeps fallback groups close to `minCompoundSize`, preserving zoomability where possible. Mark `quality.source = 'fallback-flat'`.
4. **Defensive leaf**: if the atom count somehow dropped below 2 between the zoomable check and the zoom attempt (e.g., concurrent scan), return the parent compound unchanged and mark it as a leaf.

Fallback output still satisfies the partition invariant. Fallback results are cached to avoid repeated LLM failures.

## Cache Integration

Extends Spec #4's cache model:

- **Cache key**: `(projectId, parentCompoundId, atomType)` — uniquely identifies a stratum. For stratum 0, `parentCompoundId` is `"root"`.
- **Cache entry**: stores the `Stratum` object plus its `sourceHash` at write time.
- **Cache hit**: on lookup, recompute `sourceHash` from current atoms/edges in scope and compare to stored hash. If they match → hit. If they differ → stale (invalidated).
- **Early cutoff**: after recomputing a stale stratum, compare the new set of compound IDs to the cached set. If the compound ID sets are identical (the LLM produced the same groupings despite changed inputs), **skip invalidating child strata** — their atom subsets are unchanged. This is adapted from Salsa's (rust-analyzer) "backdating" optimization and Nix's content-addressed derivations. Because compound IDs are deterministic hashes of sorted atom IDs, this comparison is cheap and reliable.
- **Cascade invalidation**: invalidation propagates in both directions. **Upward**: a child stratum's atoms are a strict subset of every ancestor's atoms, so any atom change that invalidates the child also changes the ancestor's `sourceHash`. **Downward**: when a stratum is recomputed and early cutoff does not apply (compound IDs changed), all descendant strata keyed by the old compound IDs are now orphaned and must be invalidated. Sibling strata are not invalidated in either direction — the partition invariant means they contain disjoint atoms.
- **Differential re-clustering**: when `sourceHash` changes, compute the diff between the cached stratum's atom set and the current atom set in scope: `added` = atoms in current but not cached, `removed` = atoms in cached but not current, `edgesChanged` = count of edges added or removed (symmetric difference of edge sets). If `(added.length + removed.length) / cachedAtomCount < 0.20`, use a differential prompt that includes the previous clustering and describes what changed. This biases the LLM toward stable output, reducing unnecessary compound ID churn and improving the early cutoff hit rate. When the diff exceeds 20%, use a full prompt. Edge changes alone (without atom changes) do not trigger the 20% threshold — they always use the differential prompt, since the atom set is unchanged and stability is highly likely.
- **Stale-while-revalidate**: same semantics as Spec #4. Serve stale data with a `stale: true` flag; caller decides whether to refresh.
- **Concurrency**: multiple compounds at the same stratum depth may be zoomed in parallel. Each zoom operates on a disjoint atom subset, so there are no write conflicts. Rate-limit LLM calls as needed.
- **Deduplication**: concurrent zoom requests for the *same* compound must be coalesced. The first request initiates the LLM call; subsequent requests for the same `parentCompoundId` await the in-flight result rather than spawning duplicate calls. Use a promise map keyed by `parentCompoundId`. **Error handling**: promise map entries are removed on both success and failure. Failed results are NOT cached or shared — subsequent requests after a failure spawn a fresh attempt rather than propagating the error to all waiters.

## Relationship to Existing Specs

| Spec | Impact |
|------|--------|
| Spec #04 (Data Model) | SemanticRegion/SemanticZoomLevel replaced by Atom/Compound/Stratum. Cache interface updated for new keys. |
| Spec #05 (Top-Level Clustering) | Prompt updated to use atom/compound vocabulary. Validation logic generalized. Core clustering logic reused. |
| Spec #06 (Recursive Zoom) | **Superseded entirely**. The ad-hoc recursion with directory fallback is replaced by the stratum model with monotonicity guarantees. |
| Spec #08 (Canvas Renderer) | Zoom interaction now navigates strata. Double-click on compound → load child stratum. Breadcrumbs show compound path. |
| Spec #07 (Layers) | Layer scores aggregate from atoms to compounds (same principle, new names). |

## API Contract

### `GET /api/zoom/:compoundId`

Zooms into a compound, returning its child stratum. Use `compoundId = "root"` for stratum 0.

**Response**:
```typescript
interface ZoomResponse {
  stratum: Stratum;             // the child stratum (compounds, relationships, breadcrumbs)
  stale: boolean;               // true if served from stale cache
}

/** Breadcrumbs are denormalized onto the Stratum at write time, so serving a
 *  cached stratum never requires loading ancestor strata. */
interface Breadcrumb {
  compoundId: string;           // "root" for stratum 0
  compoundName: string;         // display name (e.g., "Authentication")
  depth: number;
}
```

**Errors**:
- `404` if `compoundId` does not exist in the map
- `400` if the compound is a leaf (`zoomable = false`)

### `GET /api/map`

Returns the top-level SemanticMap (atoms + stratum 0). The frontend calls this on initial load to get the atom manifest and top-level layout. All deeper navigation uses `/api/zoom/:compoundId` to load individual strata on demand. v1 assumes the full atom set fits in a single response (practical for codebases up to ~10K files; at ~200 bytes per atom, 10K atoms ≈ 2MB). For larger codebases, a future version could paginate atoms or return only stratum 0 compounds with atom counts, deferring the full atom manifest to on-demand requests.

### `GET /api/map/overview`

Returns a flattened summary of the full hierarchy for minimap rendering. Includes all known compounds (from cached strata) with their depth, parent ID, atom count, and bounding position hints. This endpoint is lightweight — it returns compound metadata only, not full strata.

```typescript
interface MapOverview {
  compounds: OverviewCompound[];
}

interface OverviewCompound {
  id: string;
  name: string;
  parentId: string | null;   // null for stratum-0 compounds
  depth: number;
  atomCount: number;
  zoomable: boolean;
  loaded: boolean;            // true if this compound's *child* stratum is cached
  // A compound appears here because its parent stratum was loaded.
  // loaded=false means the user hasn't zoomed into this compound yet.
  // loaded=true means the child stratum exists in cache (explored).
}
```

The frontend uses this to render a minimap showing the user's position in the hierarchy, with loaded (explored) regions distinguished from unloaded regions. User studies (ExplorViz 2025) show that 15/16 participants preferred semantic zoom with a minimap over geometric zoom for maintaining spatial context.

## Pipeline Function Signatures

```typescript
/** Resolve atoms from the dependency graph — called once per scan */
function resolveAtoms(graph: DependencyGraph): Atom[];

/** Stage 1: Structural partition via community detection */
function structuralPartition(
  atomsInScope: Atom[],
  edgesInScope: ImportEdge[],
  targetClusterCount: { min: number; max: number }  // e.g., {min: 3, max: 7}
): StructuralPartition | null;  // null if graph is disconnected/edgeless

interface StructuralPartition {
  clusters: string[][];          // array of atom ID arrays
  algorithm: 'leiden' | 'infomap';
  resolution: number;            // resolution parameter used
}

/** Build a stratum via the two-stage pipeline (structural + LLM + validation + fallback).
 *  Breadcrumbs are denormalized onto the returned Stratum at write time —
 *  the caller provides the parent path and buildStratum appends the current level. */
async function buildStratum(
  parentCompound: Compound | null,  // null for stratum 0 ("root")
  atomsInScope: Atom[],
  edgesInScope: ImportEdge[],
  breadcrumbs: Breadcrumb[],        // path from root to parent (denormalized onto result)
  config: ZoomConfig,
  llm: LLMClient,
  cache: ZoomCache,
  projectId: string,
  atomType: 'file' | 'symbol'
): Promise<Stratum>;

/** Construct the LLM prompt for a given stratum */
function buildClusterPrompt(
  atomsInScope: Atom[],
  edgesInScope: ImportEdge[],
  breadcrumbs: Breadcrumb[],
  parentReferences: string[],   // parent compound's references for context
  structuralSuggestion: StructuralPartition | null,  // Stage 1 output
  previousClustering: Compound[] | null,  // for differential re-clustering
  atomDiff: AtomDiff | null,    // what changed since last clustering
  depth: number
): string;

/** Computed by diffing the cached stratum's atom/edge sets against current scope.
 *  The 20% threshold is: (added.length + removed.length) / cachedAtomCount.
 *  Edge-only changes (no atom adds/removes) always use the differential prompt. */
interface AtomDiff {
  added: string[];              // atom IDs in current scope but not in cached stratum
  removed: string[];            // atom IDs in cached stratum but not in current scope
  edgesChanged: number;         // symmetric difference of edge sets (added + removed edges)
}

/** Validate and fix LLM response, enforcing all invariants */
function validateStratum(
  raw: unknown,
  atomIdsInScope: string[],
  allAtomIds: string[],         // full project atom set (for reference validation)
  depth: number,
  config: ZoomConfig
): ValidationResult<Compound[]>;

/** Compute quality metrics for a generated stratum */
function computeQuality(
  compounds: Compound[],
  edgesInScope: ImportEdge[],
  atomsInScope: Atom[],
  source: StratumQuality['source']
): StratumQuality;

/** Generate fallback compounds when LLM fails (tiered) */
function fallbackStratum(
  atomsInScope: Atom[],
  edgesInScope: ImportEdge[],
  structuralPartition: StructuralPartition | null,
  dirTree: DirectoryNode
): Compound[];
```

## Acceptance Criteria

1. Given a project with 50 atoms, stratum 0 produces 3-7 compounds collectively covering all 50 atoms
2. Given a compound with 20 atoms, zoom produces 2-5 sub-compounds covering exactly those 20 atoms
3. No atom appears in multiple compounds within the same stratum (partition invariant)
4. No compound at stratum N+1 contains atoms from outside its parent (strict subset)
5. A compound with 4 atoms (below threshold) is marked as a leaf (`zoomable = false`) — no LLM call attempted
6. At maxStratumDepth, all compounds are leaves regardless of atom count
7. LLM returning out-of-scope atoms in atomIds → moved to references, not membership
8. LLM returning a single compound with all parent atoms → retried up to `maxRetries`, then fallback
9. References contain only valid atom IDs with weights in [0,1]; invalid references are silently dropped
10. Cross-compound relationships are generated from atom-level dependency edges between sibling compounds only
11. Full zoom path from stratum 0 to leaf stratum maintains the invariant at every level
12. Fallback output satisfies the same partition invariant as LLM output
13. Cache invalidation cascades to descendant strata but not siblings; early cutoff skips descendants when compound IDs are unchanged
14. Compound IDs are deterministic (hash of sorted atomIds) and stable across LLM re-runs
15. Stratum includes denormalized breadcrumbs; API response includes per-compound `zoomable` flag
16. Zooming a leaf compound returns 400, not an empty stratum
17. Structural partition (Leiden/Infomap) runs before LLM refinement; LLM prompt includes the structural suggestion
18. Every stratum has quality metrics (MQ, directory alignment, source) computed and stored
19. When atom diff < 20%, differential re-clustering prompt is used with previous clustering as context
20. Failed promise map entries are cleaned up and do not block subsequent retry attempts
21. `/api/map/overview` returns compound metadata for all cached strata

## Test Plan

### Behavior 1: Atom resolution
- Project with 10 .ts files → 10 atoms with correct IDs and metadata
- Atom set is immutable after scan (adding atoms requires re-scan)
- Atom metadata includes LOC and exported symbols

### Behavior 2: Stratum 0 clustering
- 50 atoms → 3-7 compounds, all atoms covered
- Each compound has name, summary, atomIds (non-empty)
- References point to valid atom IDs outside the compound
- Relationships generated from cross-compound edges

### Behavior 3: Monotonicity invariant
- Zoom into compound with 20 atoms → sub-compounds are strict subsets
- Union of sub-compound atomIds = parent's atomIds exactly
- No sub-compound contains atoms from sibling compounds
- Attempting to zoom a leaf compound → returns atoms directly, no LLM call
- LLM returning overlapping atomIds → post-processing deduplicates

### Behavior 4: Termination
- Compound with 5 atoms (below threshold 6) → leaf, no LLM call
- Compound with 6 atoms → LLM clustering attempted
- Depth 5 reached → all compounds become leaves regardless of size
- Full zoom from top to leaves completes in ≤5 strata for any project size

### Behavior 5: Reference handling
- LLM includes out-of-scope atom in atomIds → moved to references
- LLM includes valid cross-compound reference → preserved with computed weight
- LLM includes non-existent atom ID in references → silently dropped
- LLM-suggested reference with no actual dependency edges → weight = 0 → dropped
- UI receives references as weighted annotation data, not membership

### Behavior 6: Progress guard
- LLM returns 1 compound with all parent atoms → retried up to maxRetries, then fallback
- LLM returns 2 compounds (minimum) → accepted
- LLM returns 6 compounds for a zoom (above 2-5 range) → accepted with log

### Behavior 7: Fallback
- LLM failure with structural partition available → structural partition used as primary fallback
- LLM failure without structural partition → directory-based grouping preserves partition invariant
- All atoms in same directory → flat split into ceil(N/minCompoundSize) evenly distributed groups
- 13 atoms, minCompoundSize=6, same dir → [5, 4, 4] (ceil(13/6)=3 groups)
- Fallback results are cached
- Fallback + LLM results are indistinguishable in structure (both valid strata)
- `quality.source` correctly reflects which fallback tier was used

### Behavior 8: Breadcrumb context
- Stratum 2 prompt includes compound names for strata 0 and 1
- Context prevents LLM from drifting to top-level categories
- Long breadcrumb paths are included without truncation (v1)

### Behavior 9: Cache integration
- Successful zoom → cached by (projectId, parentCompoundId, atomType)
- Same zoom request → cache hit, no LLM call
- File added → atom set changes → sourceHash changes → strata invalidated
- Early cutoff: recomputed stratum with same compound IDs → child strata NOT invalidated
- Sibling strata survive invalidation
- Stale cache → response includes `stale: true`
- Small atom diff (< 20%) → differential prompt includes previous clustering
- Large atom diff (≥ 20%) → full prompt used

### Behavior 10: ID stability
- Same atom set → same compound ID across different LLM runs (even if names differ)
- Adding/removing an atom from a compound → compound ID changes
- Stratum lookup key equals parentCompoundId (or "root" for stratum 0)

### Behavior 11: API contract
- `GET /api/zoom/root` → returns stratum 0 with denormalized breadcrumbs `[{compoundId: "root", ...}]`
- `GET /api/zoom/:compoundId` → returns child stratum with breadcrumbs denormalized on the stratum
- `GET /api/zoom/:leafCompoundId` → returns 400
- `GET /api/zoom/:nonexistentId` → returns 404
- Each compound in response has `zoomable` flag set correctly

### Behavior 12: Concurrency
- Zooming 3 top-level compounds in parallel → all succeed, no cache conflicts
- Each parallel zoom operates on disjoint atom subsets
- Failed LLM call removes promise map entry; subsequent request spawns fresh attempt
- Concurrent requests for same compound coalesce into single LLM call

### Behavior 13: Two-stage clustering pipeline
- Structural partition (Leiden) runs before LLM refinement for atom sets ≥ 12
- Structural partition skipped for atom sets < 12
- Structural partition skipped when dependency graph has no edges
- LLM prompt includes structural suggestion when available
- LLM may accept, adjust, or override structural suggestion — all are valid
- Structural-only fallback produces valid strata with generic names

### Behavior 14: Quality metrics
- MQ computed from dependency edges for every stratum
- MQ = 0 when all edges cross compound boundaries
- MQ = 1 when no edges cross compound boundaries
- Directory alignment computed as MoJoFM vs directory-based partition
- `quality.source` correctly records 'llm', 'structural', 'fallback-directory', or 'fallback-flat'

### Behavior 15: Reference weights
- References include weight in [0, 1] based on edge ratio
- References with weight 0 are dropped
- Reference weights sum to ≤ 1 per compound (they are ratios of external edges)

### Behavior 16: DOI scoring
- Intrinsic DOI computed from normalized atom count (0.5), complexity (0.3), churn (0.2)
- Missing metrics (e.g., no churn data) contribute 0 — DOI degrades gracefully
- Proximity component: focus=1.0, parent/children=0.6, siblings=0.3, other=0
- DOI is advisory — does not affect partition or zoomable flag

### Behavior 17: Overview API
- `GET /api/map/overview` returns all compounds from cached strata
- A compound appears because its parent stratum was loaded (explored)
- `loaded` flag = true means this compound's *child* stratum is cached; false means unexplored
- Leaf compounds (`zoomable = false`) always have `loaded = false`

## Implementation Notes

- New directory: `src/interpret/atoms/` — atom resolution from scanner output
- New `src/interpret/partition.ts` — Leiden/Infomap structural partition (Stage 1). Consider using a WebAssembly build of the Leiden algorithm (e.g., `leiden-wasm` or binding to `leidenalg` via Python subprocess) or a pure JS community-detection library
- Refactor `src/interpret/cluster.ts` — two-stage pipeline orchestration: structural partition → LLM refinement → validation → quality metrics
- New `src/interpret/stratum.ts` — stratum construction and the zoom-into-compound pipeline
- New `src/interpret/quality.ts` — MQ computation, directory alignment (MoJoFM), DOI scoring
- Update `src/interpret/validate.ts` — partition invariant checker, reference validator (now with weights), out-of-scope fixer
- Update `src/interpret/prompt.ts` — breadcrumb context, structural suggestion injection, differential re-clustering prompts, one-shot examples
- API route `/api/zoom/:compoundId` replaces current implementation with stratum-based zoom
- New API route `/api/map/overview` — lightweight hierarchy summary for minimap
- Frontend: `useZoomLevel` hook updated to navigate strata; breadcrumbs show compound names
- Frontend: minimap component consuming `/api/map/overview` for spatial context during deep navigation

## Open Questions

1. **Atom type switching mid-zoom**: Should deeper strata be able to switch from file-atoms to symbol-atoms? (e.g., top level is files, but zooming into a 3-file compound expands to symbol-level atoms.) This would require a "re-atomization" step that replaces file atoms with their constituent symbol atoms. CodeMap (arXiv 2504.04553, April 2025) validates this approach — their three-level abstraction (global → local → detailed) with user study showed 79% reduction in reading time. Recommended for v2.

2. **Scoring atom types**: If atoms can be symbols, how do analysis layers (complexity, coverage) score them? File-level metrics are easy; symbol-level requires per-function metrics.

3. **Reference rendering**: Research points to a combination of techniques: (a) **hierarchical edge bundling** (Holten 2006) with an adjustable beta parameter (0–1) to control bundling tightness — low beta shows atom-level connections, high beta (~0.85) shows aggregate inter-compound affinity; (b) **dashed/dimmed rendering** at lower opacity than structural edges, following compound graph port conventions; (c) **reference weight** mapped to visual intensity. The overview+detail for compound graphs paper (August 2024) recommends explicit ports on compound boundaries for edge routing.

4. **Leiden resolution parameter tuning**: the resolution parameter controls granularity. Should it be fixed, or should the system try multiple resolution values and select the one that produces a cluster count closest to the target range? Adaptive tuning adds complexity but removes a magic number.

5. **Neighbourhood-preserving layout**: should the API emit inter-compound similarity scores so the frontend can use neighbourhood-preserving Voronoi treemaps (IEEE TVCG 2025) to position semantically similar compounds adjacently? This would give the map meaningful spatial topology beyond hierarchy alone.

6. ~~**Constrained decoding**~~: **Resolved.** v1 uses post-hoc validation. Constrained decoding can be adopted opportunistically as model support improves — the validation pipeline remains as a safety net regardless, so constrained decoding is a performance optimization (fewer retries), not an architectural decision.

## References

Key papers and tools that informed this spec:

- Traag et al., "From Louvain to Leiden: guaranteeing well-connected communities" (Nature Scientific Reports, 2019)
- SemArc, "Software Architecture Recovery Augmented with Semantics" (IEEE, 2025) — 32% improvement over classical methods
- ArchAgent, "Scalable Legacy Software Architecture Recovery with LLMs" (arXiv 2601.13007, 2025) — F1 = 0.966
- Microsoft GraphRAG — hierarchical Leiden + LLM community summarization
- Salsa (rust-analyzer) — durable incrementality, early cutoff via backdating
- Holten, "Hierarchical Edge Bundles" (IEEE InfoVis, 2006)
- CodeMap, "Automated Codebase Decomposition" (arXiv 2504.04553, 2025) — three-level abstraction, 79% reading time reduction
- ExplorViz, "Semantic Zoom and Mini-Maps for Software Cities" (arXiv 2510.00003, 2025) — 15/16 users prefer semantic zoom with minimap
- "Neighbourhood-Preserving Voronoi Treemaps" (IEEE TVCG, 2025) — similarity-aware spatial layout
- Furnas, "Generalized fisheye views" (CHI, 1986) / Card & Nation, "DOI Trees" (AVI, 2002)
- ICSE LLM4Code 2025 — structured prompting +13% completeness improvement
- Cockburn et al., "A review of overview+detail, zooming, and focus+context interfaces" (ACM Computing Surveys, 2009)
