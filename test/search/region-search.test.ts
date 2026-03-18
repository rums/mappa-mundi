import { describe, it, expect } from 'vitest';
import { searchRegions } from '../../src/search/region-search';
import type { SemanticRegion } from '../../src/semantic-zoom';
import type { SearchResult } from '../../src/search/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeRegion(overrides: Partial<SemanticRegion> = {}): SemanticRegion {
  return {
    id: overrides.id ?? 'region-1',
    name: overrides.name ?? 'Auth System',
    summary: overrides.summary ?? 'Handles authentication and authorization',
    modules: overrides.modules ?? ['src/auth/login.ts'],
    directories: overrides.directories ?? ['src/auth'],
    regionHash: overrides.regionHash ?? 'abc123',
    childZoom: undefined,
  };
}

// ─── Behavior 2: Region Search (Layer 2) ────────────────────────────────────

describe('Region Search: name matching', () => {
  it('should match query "auth" against region named "Authentication System"', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Authentication System', summary: 'Handles user auth' }),
    ];

    const results = searchRegions('auth', regions);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].regionId).toBe('r1');
    expect(results[0].matchLayer).toBe('region');
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.5);
    expect(results[0].relevanceScore).toBeLessThanOrEqual(0.8);
  });

  it('should match query "where does auth happen" against "Authentication System"', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Authentication System', summary: 'Manages login, session tokens, and JWT validation' }),
      makeRegion({ id: 'r2', name: 'Data Layer', summary: 'Database access and ORM' }),
    ];

    const results = searchRegions('where does auth happen', regions);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].regionId).toBe('r1');
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.5);
  });

  it('should be case insensitive', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Authentication System' }),
    ];

    const results = searchRegions('AUTHENTICATION', regions);

    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Region Search: summary matching', () => {
  it('should match query against region summary text', () => {
    const regions = [
      makeRegion({
        id: 'r1',
        name: 'Security',
        summary: 'Handles user login and session management',
      }),
    ];

    const results = searchRegions('handles user login', regions);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].regionId).toBe('r1');
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.3);
    expect(results[0].relevanceScore).toBeLessThanOrEqual(0.6);
  });

  it('should rank name matches higher than summary matches', () => {
    const regions = [
      makeRegion({
        id: 'r-name',
        name: 'Login System',
        summary: 'Something unrelated',
      }),
      makeRegion({
        id: 'r-summary',
        name: 'Security',
        summary: 'Handles login flows and session tokens',
      }),
    ];

    const results = searchRegions('login', regions);

    expect(results.length).toBe(2);
    const nameMatch = results.find(r => r.regionId === 'r-name')!;
    const summaryMatch = results.find(r => r.regionId === 'r-summary')!;
    expect(nameMatch.relevanceScore).toBeGreaterThan(summaryMatch.relevanceScore);
  });
});

describe('Region Search: multiple matches', () => {
  it('should return multiple partial matches ranked by score', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'User Authentication', summary: 'Login' }),
      makeRegion({ id: 'r2', name: 'API Gateway', summary: 'Auth middleware' }),
      makeRegion({ id: 'r3', name: 'Database', summary: 'Data storage' }),
    ];

    const results = searchRegions('auth', regions);

    // At least r1 and r2 should match
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Results should be sorted by relevance
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
    }
  });

  it('should return empty array when no regions match', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Auth', summary: 'Authentication' }),
    ];

    const results = searchRegions('completely unrelated xyz', regions);

    expect(results).toEqual([]);
  });
});

describe('Region Search: explanations', () => {
  it('should include non-empty explanation for region name match', () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Authentication System' }),
    ];

    const results = searchRegions('authentication', regions);

    expect(results[0].explanation).toBeTruthy();
    expect(results[0].explanation.length).toBeGreaterThan(0);
  });
});
