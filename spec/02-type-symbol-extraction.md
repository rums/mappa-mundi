# Spec 02: Structural Scanner — Type & Symbol Extraction

> GitHub Issue: #2
> Dependencies: Spec #1 (module dependency graph, parser infrastructure)
> Status: ready for TDD

## Intent

Extend the structural scanner to extract type definitions, function signatures, and class declarations from each module — producing the raw material for semantic interpretation by an LLM.

## Scope

### In Scope
- Extract from each module: interfaces, type aliases, enums, functions, classes, constants/variables with type annotations
- Both exported and non-exported (internal) symbols captured
- Human-readable signature strings suitable for LLM consumption
- Generic type parameters preserved in signatures
- Integration with Spec #1: symbols attach to ModuleNode

### Out of Scope
- Full AST preservation — we capture names and signatures, not syntax trees
- Namespace/module declarations (`namespace Foo {}`) — uncommon in modern TS, excluded for v1
- Ambient declarations from `.d.ts` files (excluded in Spec #1)
- Re-exported symbols: a barrel file's `symbols[]` contains only locally-declared symbols. Re-exports are tracked via Spec #1's ExportInfo/edges.

## Data Model Extension

```typescript
// Added to ModuleNode from Spec #1
interface ModuleNode {
  // ... existing fields (id, filePath, exports)
  symbols: SymbolInfo[];
}

interface SymbolInfo {
  name: string;
  kind: 'interface' | 'type' | 'enum' | 'function' | 'class' | 'variable';
  exported: boolean;
  signature: string;  // human-readable signature (see format below)
}
```

## Design Decisions

1. **Enum support**: `enum` is a first-class kind. `const enum` is also captured as kind `enum`.
2. **Signature format convention**:
   - Interface: `{ name: string; email: string }` (field names and types)
   - Function: `(token: string): Promise<User>` (params and return type)
   - Class: `{ constructor(name: string); validate(): boolean; email: string }` (public members only)
   - Type alias: the right-hand side, e.g., `'active' | 'inactive'`
   - Enum: `{ Up, Down, Left, Right }` (member names)
   - Variable: the type annotation, e.g., `Map<string, Handler>`
3. **Generic type parameters**: included in signature, e.g., `<T>(x: T): T` for a generic function, `<T>{ data: T }` for a generic interface.
4. **Overloaded functions**: single SymbolInfo entry. Signature shows the implementation signature (or the last overload if no implementation).
5. **Class members**: only public members in signature. Private/protected excluded — LLM doesn't need internal implementation details.
6. **Arrow functions as const**: `export const fn = (x: string) => x` captured as kind `variable` with the function type as its signature. Only `function` declarations get kind `function`.
7. **Variables without type annotation**: captured with signature `(inferred)` — their name still matters for LLM interpretation.
8. **Two-pass approach**: Spec #1 builds the graph (pass 1), Spec #2 enriches nodes with symbols (pass 2). Same parser, separated concerns.

## Acceptance Criteria

1. Given `export interface User { name: string; email: string }`, extracts SymbolInfo with name `User`, kind `interface`, exported `true`, signature `{ name: string; email: string }`
2. Given `export function authenticate(token: string): Promise<User>`, extracts SymbolInfo with name `authenticate`, kind `function`, exported `true`, signature `(token: string): Promise<User>`
3. Given a class with public methods and properties, extracts SymbolInfo with kind `class` and signature listing public members
4. Given `export enum Direction { Up, Down }`, extracts SymbolInfo with kind `enum`, signature `{ Up, Down }`
5. Given non-exported declarations (`function helper()`, `interface Internal`), extracts them with exported `false`
6. Given `export type Status = 'active' | 'inactive'`, extracts kind `type` with signature `'active' | 'inactive'`
7. After scanning, each ModuleNode in the DependencyGraph has a populated `symbols` array
8. A module with no declarations has `symbols: []`
9. Generic type parameters appear in signatures: `<T>(x: T): T`
10. A barrel file that only re-exports has `symbols: []` (re-exports are not local declarations)

## Test Plan

### Behavior 1: Interface extraction
- Basic interface with fields
- Empty interface
- Interface extending another: `interface Admin extends User`
- Optional fields: `email?: string`
- Method signatures on interface: `validate(): boolean`
- Index signatures: `[key: string]: unknown`
- Generic interface: `interface Response<T> { data: T }`

### Behavior 2: Function extraction
- Basic exported function with params and return type
- Function with no parameters
- Function with no return type annotation → signature shows `(): void` or similar
- Default parameter values (type preserved, default omitted from signature)
- Rest parameters: `...args: string[]`
- Async function: `async function fetch(): Promise<Data>`
- Generic function: `function identity<T>(x: T): T`
- Overloaded function → single entry with implementation signature

### Behavior 3: Class extraction
- Class with constructor, public methods, public properties
- Constructor parameter properties: `constructor(private name: string)` — `name` excluded from signature (private)
- Abstract class with abstract methods
- Static methods and properties included in signature (marked as static)
- Private/protected members excluded from signature
- Getter/setter → appears as property in signature
- Generic class: `class Container<T>`

### Behavior 4: Enum extraction
- Basic enum: `enum Direction { Up, Down }`
- String enum: `enum Color { Red = 'red' }`
- Const enum: `const enum Flags { A, B }`

### Behavior 5: Type alias and variable extraction
- Union type alias: `type Status = 'active' | 'inactive'`
- Complex mapped/conditional type (signature may be long — that's OK)
- Typed const: `const MAX: number = 100`
- Untyped const: `const x = 42` → signature `(inferred)`
- Destructured export: `export const { a, b } = obj` → individual variable entries

### Behavior 6: Integration with dependency graph
- Symbols attach to correct ModuleNode by id
- Module with no symbols → `symbols: []`
- Barrel file with only re-exports → `symbols: []`
- Large module with 50+ symbols → all captured
- Graph serialization still round-trips with symbols included

## Implementation Notes

- Extend the `src/parser.ts` from Spec #1 with a `extractSymbols(ast): SymbolInfo[]` function
- Or create `src/symbol-extractor.ts` as a separate module
- Use the same SWC parser from Spec #1 — parse once, extract both imports and symbols from the same AST
