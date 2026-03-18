# Spec 01: Structural Scanner — Module Dependency Graph

> GitHub Issue: #1
> Dependencies: none (foundation layer)
> Status: ready for TDD

## Intent

Build a structural scanner that parses a TypeScript/JavaScript project and produces a module dependency graph with import/export edges. This is the foundation layer — all subsequent analysis builds on this graph.

## Scope

### In Scope
- Parse `.ts`, `.tsx`, `.js`, `.jsx` files
- Extract imports: named, default, namespace, re-exports, side-effect, type-only
- Extract exports: named, default, re-exports
- Build a directed graph: nodes = project-internal modules, edges = import relationships
- Path alias resolution via tsconfig `compilerOptions.paths` and `baseUrl`
- Barrel file handling: `index.ts` re-export resolution, directory imports
- JSON round-trip serialization of the graph
- File discovery via tsconfig `include`/`exclude` when present, glob fallback

### Out of Scope
- Dynamic imports (`import()` expressions) — deferred to v2
- `node_modules` / external dependencies as graph nodes (external imports are ignored)
- `.d.ts` declaration files (excluded from nodes)
- Runtime analysis of any kind

## Data Model

```typescript
interface DependencyGraph {
  root: string;          // project root path
  nodes: ModuleNode[];
  edges: ImportEdge[];
}

interface ModuleNode {
  id: string;            // relative file path from project root
  filePath: string;      // absolute path
  exports: ExportInfo[];
}

interface ImportEdge {
  source: string;        // importer module id
  target: string;        // imported module id
  imports: ImportInfo[];  // what symbols are imported
}

interface ImportInfo {
  name: string;
  alias?: string;
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 'type-only';
}

interface ExportInfo {
  name: string;
  alias?: string;
  kind: 'named' | 'default' | 're-export';
  source?: string;       // for re-exports: the source module id
}
```

## Design Decisions

1. **Side-effect imports** (`import './polyfill'`): included as edges with a single ImportInfo of kind `side-effect`
2. **Type-only imports** (`import type { Foo }`): included as edges with kind `type-only` — they represent real dependency relationships even though erased at runtime
3. **Multiple imports from same module**: collapsed into a single edge with combined ImportInfo array
4. **Circular dependencies**: represented naturally in the directed graph (A→B and B→A are simply two edges). No special handling needed.
5. **External/bare specifiers** (`import lodash`): ignored entirely. Only project-internal modules appear as nodes and edges.
6. **Test files**: excluded by default. Configurable via options.
7. **File discovery**: use tsconfig `include`/`exclude` when a tsconfig.json is present; fall back to recursive glob for `.ts/.tsx/.js/.jsx` respecting `.gitignore`.
8. **Error handling**: best-effort. Unparseable files produce a node with empty exports and a warning. Unresolvable imports are skipped with a warning. The scan never fails entirely due to one bad file.
9. **Parser choice**: use `@swc/core` for speed. Must handle 1000+ file projects comfortably.

## Acceptance Criteria

1. Given a project with 3 files where A imports from B and B imports from C, the scanner produces a graph with 3 nodes and 2 directed edges (A→B, B→C)
2. Given a file with named, default, and namespace imports from the same module, the scanner produces 1 edge with 3 ImportInfo entries of the correct kinds
3. Given a barrel file (`index.ts`) that re-exports from sub-modules, the scanner captures re-export edges and the barrel's ExportInfo includes re-exported symbols
4. Given a tsconfig with path aliases (`@/utils` → `src/utils`), imports using aliases resolve to the correct target module
5. Given a file with no imports or exports, it appears as an isolated node in the graph
6. The graph round-trips through JSON.stringify/JSON.parse to a structurally identical result
7. Given a file with `import type { Foo } from './types'`, the scanner produces an edge with kind `type-only`
8. Given a file with `import './polyfill'`, the scanner produces an edge with kind `side-effect`
9. Given circular dependencies (A→B→A), the scanner produces 2 nodes and 2 edges without infinite loops
10. Given a file with syntax errors, the scanner still completes — producing a node for the bad file with empty exports and logging a warning

## Test Plan

### Behavior 1: Basic graph construction
- 3-file chain: A→B→C produces 3 nodes, 2 edges
- Fan-out: A imports B and C → 3 nodes, 2 edges
- Fan-in: B and C both import A → 3 nodes, 2 edges
- Circular: A→B→A → 2 nodes, 2 edges
- Mixed extensions: `.ts` imports `.tsx` imports `.js`
- Nested directories: `src/a.ts` imports `src/lib/b.ts`

### Behavior 2: Import kind extraction
- Named: `import { foo } from 'x'` → kind `named`
- Default: `import bar from 'x'` → kind `default`
- Namespace: `import * as baz from 'x'` → kind `namespace`
- Mixed: `import React, { useState } from 'react'` → default + named (but this is external, so skipped)
- Aliased: `import { foo as bar } from './x'` → name `foo`, alias `bar`, kind `named`
- Side-effect: `import './x'` → kind `side-effect`
- Type-only: `import type { Foo } from './x'` → kind `type-only`
- Multiple imports from same module → single edge, combined ImportInfo

### Behavior 3: Re-exports and barrel files
- `export { foo } from './sub'` → edge to sub, ExportInfo with kind `re-export`
- `export * from './sub'` → edge to sub, wildcard re-export
- `export { default as Named } from './sub'` → edge to sub, renamed re-export
- Nested barrels: `index.ts` → `sub/index.ts` → `sub/impl.ts`
- Directory import: `import { foo } from './components'` → resolves to `components/index.ts`

### Behavior 4: Path alias resolution
- Single alias: `@/utils` → `src/utils`
- Multiple alias patterns: `@components/*`, `@/lib/*`
- `baseUrl` interaction with paths
- tsconfig `extends` inheriting paths from parent config
- No tsconfig present → standard relative/directory resolution
- Alias resolves to directory → finds `index.ts`

### Behavior 5: Isolated nodes and edge cases
- Empty file → node with empty exports, no edges
- Comments-only file → node with empty exports
- File with only type declarations → node present
- Syntax error file → node present, empty exports, warning logged

### Behavior 6: Serialization
- Round-trip empty graph
- Round-trip graph with special characters in paths (spaces, unicode)
- Round-trip large graph (synthetic 100+ nodes)

## Project Bootstrap

- Runtime: Node.js / TypeScript
- Test framework: vitest
- Parser: @swc/core
- Layout:
  ```
  src/
    types.ts       — DependencyGraph, ModuleNode, ImportEdge, ImportInfo, ExportInfo
    scanner.ts     — main scan(projectRoot, options?) entry point
    parser.ts      — file parsing, import/export extraction
    resolver.ts    — path resolution (aliases, barrel files, relative paths)
  test/
    fixtures/      — small TS projects for each test behavior
    scanner.test.ts
    parser.test.ts
    resolver.test.ts
  ```
