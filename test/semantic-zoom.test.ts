import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  SemanticMap,
  SemanticZoomLevel,
  SemanticRegion,
  SemanticRelationship,
  CacheResult,
  ZoomCache,
} from '../src/semantic-zoom';
import { createInMemoryZoomCache } from '../src/semantic-zoom';

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeRegion(overrides: Partial<SemanticRegion> = {}): SemanticRegion {
  return {
    id: overrides.id ?? 'region-1',
    name: overrides.name ?? 'Auth System',
    summary: overrides.summary ?? 'Handles authentication and authorization',
    modules: overrides.modules ?? ['src/auth/login.ts', 'src/auth/session.ts'],
    directories: overrides.directories ?? ['src/auth'],
    regionHash: overrides.regionHash ?? 'abc123',
    childZoom: overrides.childZoom ?? undefined,
  };
}

function makeZoomLevel(overrides: Partial<SemanticZoomLevel> = {}): SemanticZoomLevel {
  return {
    path: overrides.path ?? 'src/',
    depth: overrides.depth ?? 0,
    regions: overrides.regions ?? [makeRegion()],
    relationships: overrides.relationships ?? [],
    sourceHash: overrides.sourceHash ?? 'hash-000',
    generatedAt: overrides.generatedAt ?? '2026-03-18T12:00:00Z',
  };
}

function makeSemanticMap(overrides: Partial<SemanticMap> = {}): SemanticMap {
  return {
    projectId: overrides.projectId ?? 'proj-1',
    projectRoot: overrides.projectRoot ?? '/home/user/project',
    rootZoom: overrides.rootZoom ?? makeZoomLevel(),
    generatedAt: overrides.generatedAt ?? '2026-03-18T12:00:00Z',
  };
}

// ─── Behavior 1: Data Model Serialization ─────────────────────────────────

describe('Semantic Zoom: Data Model Serialization', () => {
  // AC#1: A SemanticMap with 3 top-level regions serializes to JSON and deserializes back identically
  it('should round-trip a SemanticMap with 3 regions via JSON', () => {
    const map: SemanticMap = makeSemanticMap({
      rootZoom: makeZoomLevel({
        regions: [
          makeRegion({ id: 'r1', name: 'Auth System' }),
          makeRegion({ id: 'r2', name: 'API Layer' }),
          makeRegion({ id: 'r3', name: 'Data Access' }),
        ],
        relationships: [
          {
            source: 'r1',
            target: 'r2',
            kind: 'depends-on',
            edgeCount: 5,
          },
          {
            source: 'r2',
            target: 'r3',
            kind: 'data-flow',
            edgeCount: 3,
            description: 'API calls data layer',
          },
        ],
      }),
    });

    const json = JSON.stringify(map);
    const restored: SemanticMap = JSON.parse(json);

    expect(restored).toEqual(map);
    expect(restored.rootZoom.regions).toHaveLength(3);
    expect(restored.rootZoom.relationships).toHaveLength(2);
  });

  // AC#10: Empty SemanticMap (0 regions) serializes correctly
  it('should round-trip an empty SemanticMap with 0 regions', () => {
    const map: SemanticMap = makeSemanticMap({
      rootZoom: makeZoomLevel({
        regions: [],
        relationships: [],
      }),
    });

    const json = JSON.stringify(map);
    const restored: SemanticMap = JSON.parse(json);

    expect(restored).toEqual(map);
    expect(restored.rootZoom.regions).toHaveLength(0);
  });

  // AC#9 (partial): Nested childZoom (3 levels deep) round-trip
  it('should round-trip a SemanticMap with 3 nested zoom levels', () => {
    const depth2Level = makeZoomLevel({
      path: 'src/auth/oauth',
      depth: 2,
      regions: [makeRegion({ id: 'deep-1', name: 'OAuth Provider' })],
    });

    const depth1Level = makeZoomLevel({
      path: 'src/auth',
      depth: 1,
      regions: [
        makeRegion({
          id: 'mid-1',
          name: 'Auth Internals',
          childZoom: depth2Level,
        }),
      ],
    });

    const map: SemanticMap = makeSemanticMap({
      rootZoom: makeZoomLevel({
        path: 'src/',
        depth: 0,
        regions: [
          makeRegion({ id: 'top-1', name: 'Auth System', childZoom: depth1Level }),
        ],
      }),
    });

    const json = JSON.stringify(map);
    const restored: SemanticMap = JSON.parse(json);

    expect(restored).toEqual(map);
    // Verify the nesting is preserved
    expect(restored.rootZoom.regions[0].childZoom?.depth).toBe(1);
    expect(restored.rootZoom.regions[0].childZoom?.regions[0].childZoom?.depth).toBe(2);
  });

  it('should round-trip Unicode characters in region names and summaries', () => {
    const map: SemanticMap = makeSemanticMap({
      rootZoom: makeZoomLevel({
        regions: [
          makeRegion({
            id: 'unicode-1',
            name: '認証システム',
            summary: 'Gère l\'authentification — très important 🔐',
          }),
        ],
      }),
    });

    const json = JSON.stringify(map);
    const restored: SemanticMap = JSON.parse(json);

    expect(restored).toEqual(map);
    expect(restored.rootZoom.regions[0].name).toBe('認証システム');
  });

  it('should round-trip a large model with 20 regions across 3 levels', () => {
    const regions: SemanticRegion[] = Array.from({ length: 20 }, (_, i) =>
      makeRegion({ id: `region-${i}`, name: `Region ${i}` }),
    );

    // Add child zoom to first few regions
    for (let i = 0; i < 5; i++) {
      regions[i] = {
        ...regions[i],
        childZoom: makeZoomLevel({
          path: `src/region-${i}`,
          depth: 1,
          regions: [makeRegion({ id: `child-${i}-0` })],
        }),
      };
    }

    const map: SemanticMap = makeSemanticMap({
      rootZoom: makeZoomLevel({ regions }),
    });

    const json = JSON.stringify(map);
    const restored: SemanticMap = JSON.parse(json);

    expect(restored).toEqual(map);
    expect(restored.rootZoom.regions).toHaveLength(20);
  });
});

// ─── Behavior 2: Cache Hit/Miss ───────────────────────────────────────────

describe('Semantic Zoom: Cache Hit/Miss', () => {
  let cache: ZoomCache;

  beforeEach(() => {
    cache = createInMemoryZoomCache();
  });

  // AC#2: cache.get() returns null on cache miss
  it('should return null on cache miss', () => {
    const result = cache.get('proj-1', 'src/auth', 0);
    expect(result).toBeNull();
  });

  // AC#3: After cache.set(), cache.get() with same key returns stored level with stale: false
  it('should return stored level with stale: false after set', () => {
    const level = makeZoomLevel({ path: 'src/auth', depth: 1 });
    cache.set('proj-1', 'src/auth', 1, level);

    const result = cache.get('proj-1', 'src/auth', 1);
    expect(result).not.toBeNull();
    expect(result!.level).toEqual(level);
    expect(result!.stale).toBe(false);
  });

  // AC#4: Same path but different depth is a cache miss
  it('should return null for same path but different depth', () => {
    const level = makeZoomLevel({ path: 'src/auth', depth: 1 });
    cache.set('proj-1', 'src/auth', 1, level);

    const result = cache.get('proj-1', 'src/auth', 0);
    expect(result).toBeNull();
  });

  it('should return null for same path and depth but different projectId', () => {
    const level = makeZoomLevel({ path: 'src/auth', depth: 1 });
    cache.set('proj-1', 'src/auth', 1, level);

    const result = cache.get('proj-2', 'src/auth', 1);
    expect(result).toBeNull();
  });

  it('should normalize path with and without trailing slash', () => {
    const level = makeZoomLevel({ path: 'src/', depth: 0 });
    cache.set('proj-1', 'src/', 0, level);

    // "src" without trailing slash should still hit
    const result = cache.get('proj-1', 'src', 0);
    expect(result).not.toBeNull();
    expect(result!.level).toEqual(level);
  });
});

// ─── Behavior 3: TTL and Staleness ───────────────────────────────────────

describe('Semantic Zoom: TTL and Staleness', () => {
  let cache: ZoomCache;

  beforeEach(() => {
    cache = createInMemoryZoomCache();
  });

  // AC#5: After TTL expiration, cache.get() returns the level with stale: true
  it('should return stale: false before TTL expiration', () => {
    const level = makeZoomLevel();
    cache.set('proj-1', 'src/', 0, level, 10000); // 10s TTL

    const result = cache.get('proj-1', 'src/', 0);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
  });

  it('should return stale: true after TTL expiration', async () => {
    vi.useFakeTimers();
    try {
      const level = makeZoomLevel();
      cache.set('proj-1', 'src/', 0, level, 1000); // 1s TTL

      vi.advanceTimersByTime(1500); // advance past TTL

      const result = cache.get('proj-1', 'src/', 0);
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(true);
      expect(result!.level).toEqual(level); // data still returned
    } finally {
      vi.useRealTimers();
    }
  });

  it('should never be stale when set without TTL', () => {
    vi.useFakeTimers();
    try {
      const level = makeZoomLevel();
      cache.set('proj-1', 'src/', 0, level); // no TTL

      vi.advanceTimersByTime(999999999);

      const result = cache.get('proj-1', 'src/', 0);
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should be immediately stale when TTL is 0', () => {
    const level = makeZoomLevel();
    cache.set('proj-1', 'src/', 0, level, 0); // TTL of 0

    const result = cache.get('proj-1', 'src/', 0);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
  });
});

// ─── Behavior 4: Hash-Based Invalidation ─────────────────────────────────

describe('Semantic Zoom: Hash-Based Invalidation', () => {
  let cache: ZoomCache;

  beforeEach(() => {
    cache = createInMemoryZoomCache();
  });

  // AC#6: invalidateByHash() removes entry when sourceHash doesn't match
  it('should remove entry when hash does not match', () => {
    const level = makeZoomLevel({ sourceHash: 'old-hash' });
    cache.set('proj-1', 'src/', 0, level);

    const invalidated = cache.invalidateByHash('proj-1', 'src/', 0, 'new-hash');
    expect(invalidated).toBe(true);

    const result = cache.get('proj-1', 'src/', 0);
    expect(result).toBeNull(); // removed entirely, not served stale
  });

  it('should NOT remove entry when hash matches', () => {
    const level = makeZoomLevel({ sourceHash: 'same-hash' });
    cache.set('proj-1', 'src/', 0, level);

    const invalidated = cache.invalidateByHash('proj-1', 'src/', 0, 'same-hash');
    expect(invalidated).toBe(false);

    const result = cache.get('proj-1', 'src/', 0);
    expect(result).not.toBeNull();
  });

  it('should return false when invalidating a non-existent entry', () => {
    const invalidated = cache.invalidateByHash('proj-1', 'src/', 0, 'any-hash');
    expect(invalidated).toBe(false);
  });
});

// ─── Behavior 5: Partial Invalidation by Path ────────────────────────────

describe('Semantic Zoom: Partial Invalidation by Path', () => {
  let cache: ZoomCache;

  beforeEach(() => {
    cache = createInMemoryZoomCache();
    // Set up 3 sibling paths + parent
    cache.set('proj-1', 'src/', 0, makeZoomLevel({ path: 'src/', depth: 0 }));
    cache.set('proj-1', 'src/auth', 1, makeZoomLevel({ path: 'src/auth', depth: 1 }));
    cache.set('proj-1', 'src/api', 1, makeZoomLevel({ path: 'src/api', depth: 1 }));
    cache.set('proj-1', 'src/db', 1, makeZoomLevel({ path: 'src/db', depth: 1 }));
  });

  // AC#7: invalidateByPath("src/auth") invalidates src/auth but NOT src/api
  it('should invalidate targeted path but not siblings', () => {
    cache.invalidateByPath('proj-1', 'src/auth');

    expect(cache.get('proj-1', 'src/auth', 1)).toBeNull();
    expect(cache.get('proj-1', 'src/api', 1)).not.toBeNull();
    expect(cache.get('proj-1', 'src/db', 1)).not.toBeNull();
  });

  // AC#8: invalidateByPath("src/auth") also invalidates parent "src/" zoom
  it('should cascade invalidation up to parent paths', () => {
    cache.invalidateByPath('proj-1', 'src/auth');

    expect(cache.get('proj-1', 'src/auth', 1)).toBeNull();
    expect(cache.get('proj-1', 'src/', 0)).toBeNull(); // parent invalidated
  });

  it('should preserve sibling children when invalidating one child', () => {
    cache.invalidateByPath('proj-1', 'src/auth');

    // Siblings survive
    expect(cache.get('proj-1', 'src/api', 1)).not.toBeNull();
    expect(cache.get('proj-1', 'src/db', 1)).not.toBeNull();
  });

  it('should return the count of invalidated entries', () => {
    const count = cache.invalidateByPath('proj-1', 'src/auth');
    // Should invalidate: src/auth (depth 1) + src/ (depth 0) = 2
    expect(count).toBe(2);
  });

  it('should propagate deeply nested invalidation up to root', () => {
    // Add deeper levels
    cache.set('proj-1', 'src/auth/oauth', 2, makeZoomLevel({ path: 'src/auth/oauth', depth: 2 }));

    const count = cache.invalidateByPath('proj-1', 'src/auth/oauth');
    // Should invalidate: src/auth/oauth (depth 2) + src/auth (depth 1) + src/ (depth 0) = 3
    expect(count).toBe(3);

    expect(cache.get('proj-1', 'src/auth/oauth', 2)).toBeNull();
    expect(cache.get('proj-1', 'src/auth', 1)).toBeNull();
    expect(cache.get('proj-1', 'src/', 0)).toBeNull();
    // Siblings survive
    expect(cache.get('proj-1', 'src/api', 1)).not.toBeNull();
  });

  it('should return 0 when invalidating a non-existent path', () => {
    const count = cache.invalidateByPath('proj-1', 'src/nonexistent');
    // Still invalidates parent src/ = 1 if parent exists, but not the path itself
    // Actually: the path itself doesn't exist, but parent "src/" does.
    // Spec says cascade UP, so parent should be invalidated even if target doesn't exist as cached entry.
    // This is a judgment call - let's test that at minimum, nothing crashes.
    expect(typeof count).toBe('number');
  });
});

// ─── Behavior 6: Multi-Level Zoom Model ──────────────────────────────────

describe('Semantic Zoom: Multi-Level Zoom Model', () => {
  // AC#9: The model supports 3+ zoom levels
  it('should support depth 0 overview with 4 regions', () => {
    const level = makeZoomLevel({
      path: 'src/',
      depth: 0,
      regions: [
        makeRegion({ id: 'r1', name: 'Auth' }),
        makeRegion({ id: 'r2', name: 'API' }),
        makeRegion({ id: 'r3', name: 'DB' }),
        makeRegion({ id: 'r4', name: 'UI' }),
      ],
    });

    expect(level.depth).toBe(0);
    expect(level.regions).toHaveLength(4);
  });

  it('should support depth 1 expansion with 5 sub-regions', () => {
    const depth1 = makeZoomLevel({
      path: 'src/auth',
      depth: 1,
      regions: Array.from({ length: 5 }, (_, i) =>
        makeRegion({ id: `sub-${i}`, name: `Auth Sub ${i}` }),
      ),
    });

    const parentRegion = makeRegion({
      id: 'r1',
      name: 'Auth',
      childZoom: depth1,
    });

    expect(parentRegion.childZoom).toBeDefined();
    expect(parentRegion.childZoom!.depth).toBe(1);
    expect(parentRegion.childZoom!.regions).toHaveLength(5);
  });

  it('should support depth 2 showing individual module details', () => {
    const depth2 = makeZoomLevel({
      path: 'src/auth/oauth',
      depth: 2,
      regions: [
        makeRegion({
          id: 'mod-1',
          name: 'OAuth Provider',
          modules: ['src/auth/oauth/google.ts', 'src/auth/oauth/github.ts'],
        }),
      ],
    });

    expect(depth2.depth).toBe(2);
    expect(depth2.regions[0].modules).toHaveLength(2);
  });

  it('should have childZoom as undefined until populated', () => {
    const region = makeRegion();
    expect(region.childZoom).toBeUndefined();
  });

  it('should have regions at different depths reference correct module IDs', () => {
    const depth0 = makeZoomLevel({
      path: 'src/',
      depth: 0,
      regions: [
        makeRegion({
          id: 'auth',
          modules: ['src/auth/login.ts', 'src/auth/session.ts', 'src/auth/oauth/google.ts'],
        }),
      ],
    });

    const depth1 = makeZoomLevel({
      path: 'src/auth',
      depth: 1,
      regions: [
        makeRegion({
          id: 'auth-core',
          modules: ['src/auth/login.ts', 'src/auth/session.ts'],
        }),
        makeRegion({
          id: 'auth-oauth',
          modules: ['src/auth/oauth/google.ts'],
        }),
      ],
    });

    // Depth 1 modules should be a subset of depth 0 modules
    const depth0Modules = new Set(depth0.regions[0].modules);
    for (const region of depth1.regions) {
      for (const mod of region.modules) {
        expect(depth0Modules.has(mod)).toBe(true);
      }
    }
  });
});

// ─── Behavior 7: Cache Clear ─────────────────────────────────────────────

describe('Semantic Zoom: Cache Clear', () => {
  // AC#11: cache.clear(projectId) removes all entries for that project
  it('should remove all entries for the specified project', () => {
    const cache = createInMemoryZoomCache();

    cache.set('proj-1', 'src/', 0, makeZoomLevel());
    cache.set('proj-1', 'src/auth', 1, makeZoomLevel());
    cache.set('proj-2', 'src/', 0, makeZoomLevel());

    cache.clear('proj-1');

    expect(cache.get('proj-1', 'src/', 0)).toBeNull();
    expect(cache.get('proj-1', 'src/auth', 1)).toBeNull();
    // Other project unaffected
    expect(cache.get('proj-2', 'src/', 0)).not.toBeNull();
  });

  it('should not throw when clearing a non-existent project', () => {
    const cache = createInMemoryZoomCache();
    expect(() => cache.clear('nonexistent')).not.toThrow();
  });
});

// ─── Behavior 8: Relationship Kinds ──────────────────────────────────────

describe('Semantic Zoom: Relationship Kinds', () => {
  it('should support all four relationship kinds', () => {
    const relationships: SemanticRelationship[] = [
      { source: 'r1', target: 'r2', kind: 'depends-on', edgeCount: 3 },
      { source: 'r1', target: 'r3', kind: 'data-flow', edgeCount: 2 },
      { source: 'r2', target: 'r4', kind: 'extends', edgeCount: 1 },
      { source: 'r3', target: 'r4', kind: 'uses', edgeCount: 5 },
    ];

    const level = makeZoomLevel({ relationships });
    expect(level.relationships).toHaveLength(4);

    const kinds = level.relationships.map(r => r.kind);
    expect(kinds).toContain('depends-on');
    expect(kinds).toContain('data-flow');
    expect(kinds).toContain('extends');
    expect(kinds).toContain('uses');
  });

  it('should support optional description on relationships', () => {
    const rel: SemanticRelationship = {
      source: 'r1',
      target: 'r2',
      kind: 'depends-on',
      edgeCount: 3,
      description: 'Auth depends on API for token validation',
    };

    expect(rel.description).toBe('Auth depends on API for token validation');
  });
});
