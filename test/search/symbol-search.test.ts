import { describe, it, expect } from 'vitest';
import { searchSymbols } from '../../src/search/symbol-search';
import type { ModuleNode, SymbolInfo } from '../../src/types';
import type { SearchResult } from '../../src/search/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeModule(id: string, symbols: SymbolInfo[]): ModuleNode {
  return {
    id,
    filePath: `/project/${id}`,
    exports: [],
    symbols,
  };
}

function sym(name: string, kind: SymbolInfo['kind'] = 'function', exported = true): SymbolInfo {
  return { name, kind, signature: `${kind} ${name}`, exported };
}

// ─── Behavior 1: Symbol Search (Layer 1) ────────────────────────────────────

describe('Symbol Search: exact match', () => {
  it('should return score ~1.0 for exact symbol name match', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('validateJWT', modules);

    expect(results).toHaveLength(1);
    expect(results[0].relevanceScore).toBeCloseTo(1.0, 1);
    expect(results[0].matchLayer).toBe('symbol');
    expect(results[0].moduleId).toBe('src/auth/jwt.ts');
  });

  it('should match case-insensitively', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('validatejwt', modules);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].relevanceScore).toBeGreaterThan(0);
  });
});

describe('Symbol Search: token/fuzzy match', () => {
  it('should match partial token "validate" against "validateJWT"', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('validate', modules);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.6);
    expect(results[0].relevanceScore).toBeLessThanOrEqual(0.9);
  });

  it('should match "JWT" against "validateJWT" via CamelCase tokenization', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('JWT', modules);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].relevanceScore).toBeGreaterThan(0);
  });

  it('should return empty array when no symbols match', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('database', modules);

    expect(results).toEqual([]);
  });
});

describe('Symbol Search: exported vs non-exported', () => {
  it('should include non-exported symbols in results', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('helperFn', 'function', false)])];

    const results = searchSymbols('helperFn', modules);

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should rank exported symbols higher than non-exported for same match quality', () => {
    const modules = [
      makeModule('src/a.ts', [sym('processData', 'function', true)]),
      makeModule('src/b.ts', [sym('processData', 'function', false)]),
    ];

    const results = searchSymbols('processData', modules);

    expect(results.length).toBe(2);
    // Exported should rank higher
    const exportedResult = results.find(r => r.moduleId === 'src/a.ts')!;
    const nonExportedResult = results.find(r => r.moduleId === 'src/b.ts')!;
    expect(exportedResult.relevanceScore).toBeGreaterThan(nonExportedResult.relevanceScore);
  });
});

describe('Symbol Search: multiple matches', () => {
  it('should return matches from multiple modules', () => {
    const modules = [
      makeModule('src/auth/jwt.ts', [sym('validateJWT')]),
      makeModule('src/auth/token.ts', [sym('validateToken')]),
    ];

    const results = searchSymbols('validate', modules);

    expect(results.length).toBe(2);
  });

  it('should return results with regionId derived from module', () => {
    const modules = [makeModule('src/auth/jwt.ts', [sym('validateJWT')])];

    const results = searchSymbols('validateJWT', modules);

    expect(results[0]).toHaveProperty('regionId');
    expect(typeof results[0].regionId).toBe('string');
  });
});
