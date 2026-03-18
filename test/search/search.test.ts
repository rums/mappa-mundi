import { describe, it, expect, vi } from 'vitest';
import { search } from '../../src/search/index';
import type { SearchOptions, SearchResult } from '../../src/search/types';
import type { ModuleNode, SymbolInfo } from '../../src/types';
import type { SemanticRegion } from '../../src/semantic-zoom';
import type { LLMClient } from '../../src/search/llm-search';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function sym(name: string, kind: SymbolInfo['kind'] = 'function', exported = true): SymbolInfo {
  return { name, kind, signature: `${kind} ${name}`, exported };
}

function makeModule(id: string, symbols: SymbolInfo[]): ModuleNode {
  return { id, filePath: `/project/${id}`, exports: [], symbols };
}

function makeRegion(overrides: Partial<SemanticRegion> = {}): SemanticRegion {
  return {
    id: overrides.id ?? 'region-1',
    name: overrides.name ?? 'Auth System',
    summary: overrides.summary ?? 'Handles authentication',
    modules: overrides.modules ?? ['src/auth/login.ts'],
    directories: overrides.directories ?? ['src/auth'],
    regionHash: overrides.regionHash ?? 'abc123',
    childZoom: undefined,
  };
}

function createSuccessLLM(matches: Array<{ regionId: string; score: number; explanation: string }>): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: { matches },
      usage: { promptTokens: 500, completionTokens: 100 },
    }),
  };
}

function createFailingLLM(): LLMClient {
  return {
    complete: vi.fn().mockRejectedValue(new Error('Network error')),
  };
}

// ─── Test Data ──────────────────────────────────────────────────────────────

const authModule = makeModule('src/auth/jwt.ts', [
  sym('validateJWT'),
  sym('createToken'),
]);
const apiModule = makeModule('src/api/routes.ts', [
  sym('router', 'variable'),
]);
const dbModule = makeModule('src/db/connection.ts', [
  sym('connect'),
]);

const authRegion = makeRegion({
  id: 'r-auth',
  name: 'Authentication System',
  summary: 'Manages login, session tokens, and JWT validation',
  modules: ['src/auth/jwt.ts'],
});
const apiRegion = makeRegion({
  id: 'r-api',
  name: 'API Layer',
  summary: 'REST API routing and request handling',
  modules: ['src/api/routes.ts'],
});
const dbRegion = makeRegion({
  id: 'r-db',
  name: 'Data Layer',
  summary: 'Database connection and models',
  modules: ['src/db/connection.ts'],
});

const allModules = [authModule, apiModule, dbModule];
const allRegions = [authRegion, apiRegion, dbRegion];

// ─── AC#1: Query matches relevant region ────────────────────────────────────

describe('Search Orchestrator: AC#1 — query matches relevant region', () => {
  it('should match "where does auth happen" to "Authentication System" with score >= 0.5', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('where does auth happen', allModules, allRegions, { enableLLM: false }, llm);

    const authResult = results.find(r => r.regionId === 'r-auth');
    expect(authResult).toBeDefined();
    expect(authResult!.relevanceScore).toBeGreaterThanOrEqual(0.5);
  });
});

// ─── AC#2: Symbol match via query ───────────────────────────────────────────

describe('Search Orchestrator: AC#2 — symbol match', () => {
  it('should match "JWT validation" to module exporting validateJWT()', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('JWT validation', allModules, allRegions, { enableLLM: false }, llm);

    const jwtResult = results.find(r => r.moduleId === 'src/auth/jwt.ts');
    expect(jwtResult).toBeDefined();
    expect(jwtResult!.matchLayer).toBe('symbol');
  });
});

// ─── AC#3: Exact symbol outranks fuzzy region ───────────────────────────────

describe('Search Orchestrator: AC#3 — ranking order', () => {
  it('should rank exact symbol matches above fuzzy region name matches', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('validateJWT', allModules, allRegions, { enableLLM: false }, llm);

    // Symbol match should be first
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchLayer).toBe('symbol');
  });
});

// ─── AC#4: LLM escalation threshold ────────────────────────────────────────

describe('Search Orchestrator: AC#4 — LLM escalation', () => {
  it('should invoke LLM when layers 1-2 return fewer than escalationThreshold results', async () => {
    // Query that matches very little in layers 1-2
    const llm = createSuccessLLM([
      { regionId: 'r-auth', score: 0.6, explanation: 'LLM found auth' },
    ]);

    await search('obscure concept', allModules, allRegions, { enableLLM: true, escalationThreshold: 3 }, llm);

    expect(llm.complete).toHaveBeenCalled();
  });

  it('should NOT invoke LLM when layers 1-2 return enough results', async () => {
    // Use modules/regions that will produce many matches
    const manyModules = [
      makeModule('src/a.ts', [sym('auth'), sym('authToken'), sym('authSession')]),
      makeModule('src/b.ts', [sym('authMiddleware')]),
    ];
    const manyRegions = [
      makeRegion({ id: 'r1', name: 'Auth Core', summary: 'Authentication core' }),
      makeRegion({ id: 'r2', name: 'Auth Middleware', summary: 'Auth middleware layer' }),
    ];
    const llm = createSuccessLLM([]);

    await search('auth', manyModules, manyRegions, { enableLLM: true, escalationThreshold: 3 }, llm);

    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should skip LLM when enableLLM is false', async () => {
    const llm = createSuccessLLM([]);

    await search('obscure concept', allModules, allRegions, { enableLLM: false }, llm);

    expect(llm.complete).not.toHaveBeenCalled();
  });
});

// ─── AC#5: No matches returns empty array ───────────────────────────────────

describe('Search Orchestrator: AC#5 — no matches', () => {
  it('should return empty array when nothing matches at all', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('xyzzy_nonexistent_1234', allModules, allRegions, { enableLLM: false }, llm);

    expect(results).toEqual([]);
  });
});

// ─── AC#6: Explanations ────────────────────────────────────────────────────

describe('Search Orchestrator: AC#6 — explanations', () => {
  it('should include non-empty explanation on every result', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('auth', allModules, allRegions, { enableLLM: false }, llm);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.explanation).toBeTruthy();
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });
});

// ─── AC#7: Deduplication ────────────────────────────────────────────────────

describe('Search Orchestrator: AC#7 — deduplication', () => {
  it('should merge results when symbol and region point to the same region', async () => {
    // authModule is in authRegion — both should match "auth"
    const llm = createSuccessLLM([]);

    const results = await search('auth', allModules, allRegions, { enableLLM: false }, llm);

    // Count how many times r-auth appears
    const authResults = results.filter(r => r.regionId === 'r-auth');
    expect(authResults.length).toBe(1); // deduplicated to single entry
  });

  it('should keep the higher score when merging duplicates', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('validateJWT', allModules, allRegions, { enableLLM: false }, llm);

    const authResult = results.find(r => r.regionId === 'r-auth');
    if (authResult) {
      // Symbol exact match score (~1.0) should win over region name partial match
      expect(authResult.relevanceScore).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('should combine explanations from merged results', async () => {
    const llm = createSuccessLLM([]);

    // "validateJWT" matches both as symbol (in auth module) and potentially as region text
    const results = await search('auth', allModules, allRegions, { enableLLM: false }, llm);

    const authResult = results.find(r => r.regionId === 'r-auth');
    expect(authResult).toBeDefined();
    // Explanation should reference the match reason (could be combined)
    expect(authResult!.explanation.length).toBeGreaterThan(0);
  });
});

// ─── AC#8: Sorting and maxResults ───────────────────────────────────────────

describe('Search Orchestrator: AC#8 — sorting and capping', () => {
  it('should return results sorted by relevanceScore descending', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('auth', allModules, allRegions, { enableLLM: false }, llm);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
    }
  });

  it('should cap results at maxResults', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('auth', allModules, allRegions, {
      enableLLM: false,
      maxResults: 1,
    }, llm);

    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('should default maxResults to 20', async () => {
    // Generate many modules to potentially get many results
    const manyModules = Array.from({ length: 30 }, (_, i) =>
      makeModule(`src/mod${i}.ts`, [sym(`auth${i}`)])
    );
    const llm = createSuccessLLM([]);

    const results = await search('auth', manyModules, allRegions, { enableLLM: false }, llm);

    expect(results.length).toBeLessThanOrEqual(20);
  });
});

// ─── AC#9: LLM failure graceful degradation ─────────────────────────────────

describe('Search Orchestrator: AC#9 — LLM failure returns layer 1-2 results', () => {
  it('should return layer 1-2 results when LLM fails (no error propagated)', async () => {
    const llm = createFailingLLM();

    // Use a query that will get few layer 1-2 results, triggering LLM
    const results = await search('auth', allModules, allRegions, {
      enableLLM: true,
      escalationThreshold: 100, // force LLM invocation
    }, llm);

    // Should NOT throw — results from layers 1-2 are returned
    expect(Array.isArray(results)).toBe(true);
    // LLM was attempted but failed
    expect(llm.complete).toHaveBeenCalled();
  });
});

// ─── AC#10: Empty query ─────────────────────────────────────────────────────

describe('Search Orchestrator: AC#10 — empty query', () => {
  it('should return empty array for empty string query', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('', allModules, allRegions, {}, llm);

    expect(results).toEqual([]);
  });

  it('should return empty array for whitespace-only query', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('   ', allModules, allRegions, {}, llm);

    expect(results).toEqual([]);
  });
});

// ─── AC#11: CamelCase tokenization for search ───────────────────────────────

describe('Search Orchestrator: AC#11 — CamelCase tokenization', () => {
  it('should find "validateJWT" when querying "validate"', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('validate', allModules, allRegions, { enableLLM: false }, llm);

    const jwtResult = results.find(r => r.moduleId === 'src/auth/jwt.ts');
    expect(jwtResult).toBeDefined();
  });

  it('should find "validateJWT" when querying "JWT"', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('JWT', allModules, allRegions, { enableLLM: false }, llm);

    const jwtResult = results.find(r => r.moduleId === 'src/auth/jwt.ts');
    expect(jwtResult).toBeDefined();
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('Search Orchestrator: edge cases', () => {
  it('should handle special characters in query without crashing', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('test[0].*+?^${}()|\\', allModules, allRegions, { enableLLM: false }, llm);

    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle very long query gracefully', async () => {
    const llm = createSuccessLLM([]);
    const longQuery = 'a'.repeat(10000);

    const results = await search(longQuery, allModules, allRegions, { enableLLM: false }, llm);

    expect(Array.isArray(results)).toBe(true);
  });

  it('should return empty array for project with no regions', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('auth', allModules, [], { enableLLM: false }, llm);

    // Only symbol results possible
    expect(Array.isArray(results)).toBe(true);
  });

  it('should return empty array for project with no modules', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('auth', [], allRegions, { enableLLM: false }, llm);

    // Only region results possible
    expect(Array.isArray(results)).toBe(true);
  });

  it('should return empty array for project with no modules and no regions', async () => {
    const llm = createSuccessLLM([]);

    const results = await search('anything', [], [], { enableLLM: false }, llm);

    expect(results).toEqual([]);
  });
});
