# Spec 03: Structural Scanner — Directory Tree & File Metrics

> GitHub Issue: #3
> Dependencies: Spec #1 (dependency graph for edge counts), Spec #2 (symbols for export counts)
> Status: ready for TDD

## Intent

Build the directory-level structural view: a tree of directories with file counts, aggregate metrics, and boundary detection. This serves as the primary input for LLM concept clustering (Spec #5).

## Scope

### In Scope
- Directory tree walking respecting `.gitignore` and configurable exclude patterns
- Per-directory metrics: file count (total and by extension), LOC, exported symbol count, inbound/outbound edges
- Subtree aggregation: each directory summarizes its entire subtree
- Boundary directory detection: directories where most import edges cross in/out
- JSON serialization of the tree

### Out of Scope
- Symlinks: not followed (avoids infinite loops). Symlink files/dirs are skipped.
- Binary files: excluded from LOC counts, included in file counts
- Non-TS/JS analysis (CSS, JSON, etc.): counted in fileCount but not in LOC or symbol metrics

## Data Model

```typescript
interface DirectoryNode {
  path: string;             // relative path from project root
  name: string;             // directory basename
  children: DirectoryNode[];
  files: string[];          // relative file paths directly in this directory
  metrics: {
    // Direct (this directory only, excluding subdirectories)
    fileCount: number;
    fileCountByExtension: Record<string, number>;  // e.g., { ".ts": 3, ".tsx": 2 }
    totalLoc: number;       // non-empty lines in TS/JS files
    exportedSymbolCount: number;
    // Cross-boundary edges (relative to this directory's boundary)
    inboundEdges: number;   // imports from outside into this directory's subtree
    outboundEdges: number;  // imports from this directory's subtree to outside
    // Subtree totals (this directory + all descendants)
    subtreeFileCount: number;
    subtreeLoc: number;
    subtreeExportedSymbolCount: number;
  };
  isBoundary: boolean;
}

interface DirectoryTreeOptions {
  excludePatterns?: string[];     // additional exclude globs beyond .gitignore
  boundaryThreshold?: number;     // default: 0.7 (proportion of cross-boundary edges)
  includeTestFiles?: boolean;     // default: false
}
```

## Design Decisions

1. **LOC definition**: non-empty lines only. Simple, deterministic, no comment-parsing needed.
2. **Subtree vs. direct metrics**: both provided. `fileCount`/`totalLoc`/`exportedSymbolCount` are direct (this directory's own files). `subtreeFileCount`/`subtreeLoc`/`subtreeExportedSymbolCount` include all descendants.
3. **Boundary threshold**: configurable via options, default 0.7 (70%). A directory is a boundary when `crossBoundaryEdges / totalEdges >= threshold`. Directories with 0 total edges are NOT boundaries.
4. **Edge counting**: only project-internal edges (from Spec #1's graph). External/node_modules imports are excluded from edge counts (they don't appear in the graph per Spec #1).
5. **Internal edges**: edges where both source and target are within the directory's subtree are internal. They do NOT count toward inbound/outbound. Parent directories see child-to-child edges as internal.
6. **Empty directories**: excluded from tree (pruned). Only directories containing files (directly or in subtree) appear.
7. **File discovery**: respects `.gitignore` (including nested `.gitignore` files), always excludes `.git/`, `node_modules/`, and user-configurable patterns.
8. **Per-extension counts**: provided for all file extensions found, not just TS/JS.

## Acceptance Criteria

1. Given `src/auth/`, `src/api/`, `src/db/` each with files, the tree has a `src/` node with 3 children
2. Given a directory with 5 TS files totaling 200 non-empty lines, metrics show `fileCount: 5`, `totalLoc: 200`
3. `node_modules/` and directories in `.gitignore` are excluded from the tree
4. The tree round-trips through JSON serialization
5. Given `src/auth/` where 75% of edges cross the boundary (with default threshold 0.7), `isBoundary` is `true`
6. Given `src/auth/` with 3 `.ts` files and 1 `.json` file, `fileCountByExtension` is `{ ".ts": 3, ".json": 1 }`
7. Subtree metrics: a parent directory's `subtreeFileCount` equals its own `fileCount` plus sum of children's `subtreeFileCount`
8. A directory with zero edges has `isBoundary: false`
9. Edges between two files inside `src/auth/` are internal — they don't count toward `inboundEdges` or `outboundEdges`
10. Empty directories (no files in subtree) don't appear in the tree

## Test Plan

### Behavior 1: Tree structure
- 3 directories under src/ → 3 children
- Deeply nested: `src/a/b/c/` → correct parent-child chain
- Single directory, no subdirs → leaf node with `children: []`
- Only dirs with files appear (empty dirs pruned)

### Behavior 2: File metrics
- 5 files, 200 non-empty lines → `fileCount: 5`, `totalLoc: 200`
- Empty file → counted in fileCount, 0 LOC
- Mixed extensions → per-extension breakdown correct
- Whitespace-only lines excluded from LOC

### Behavior 3: Gitignore exclusion
- `node_modules/` excluded
- `.git/` always excluded
- Nested `.gitignore` rules respected
- No `.gitignore` → still works, only `.git/` excluded
- Custom exclude patterns via options

### Behavior 4: Boundary detection
- 75% cross-boundary edges → boundary (threshold 0.7)
- 50% cross-boundary → not boundary
- 0 edges → not boundary
- Configurable threshold respected
- Leaf directory with single file → most edges cross by definition

### Behavior 5: Subtree aggregation
- Parent subtreeFileCount = own fileCount + sum of children's subtreeFileCount
- Root node subtree totals = entire project totals
- Leaf node: subtree totals = direct totals

### Behavior 6: Edge counting
- Edge from `src/api/x.ts` → `src/auth/y.ts`: outbound for api, inbound for auth
- Edge within `src/auth/` (both files inside): internal, not counted
- Edge from child to sibling directory: internal to parent

### Behavior 7: Integration with Spec #1 and #2
- Accepts DependencyGraph and enriched ModuleNodes as input
- Works with mocked/stubbed graph data for isolated testing
- Handles graphs with 0 nodes/edges gracefully

## Implementation Notes

- Entry point: `buildDirectoryTree(projectRoot, graph, options?): DirectoryNode`
- Separate concerns: tree walking, metric computation, boundary detection
- Use dependency injection for graph data — enables testing without Specs #1/#2
- Consider `src/directory-tree.ts` and `src/boundary-detector.ts`
