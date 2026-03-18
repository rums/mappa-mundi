package semantic

import (
	"testing"
	"time"
)

// helper to create a simple SemanticZoomLevel for cache tests.
func makeTestLevel(path string, depth int, sourceHash string) SemanticZoomLevel {
	return SemanticZoomLevel{
		Path:  path,
		Depth: depth,
		Regions: []SemanticRegion{
			{
				ID:          "test-region",
				Name:        "Test",
				Summary:     "Test region",
				Modules:     []string{"mod-test"},
				Directories: []string{path},
				RegionHash:  "region-hash-" + path,
			},
		},
		Relationships: []SemanticRelationship{},
		SourceHash:    sourceHash,
		GeneratedAt:   "2026-03-18T00:00:00Z",
	}
}

// --- Behavior 2: Cache hit/miss ---

// TestCacheGet_Miss tests AC#2: cache.get() returns nil on cache miss.
func TestCacheGet_Miss(t *testing.T) {
	cache := NewInMemoryZoomCache()

	result := cache.Get("proj-1", "src/auth", 0)
	if result != nil {
		t.Errorf("expected nil on cache miss, got %+v", result)
	}
}

// TestCacheSetThenGet tests AC#3: After set(), get() returns stored level with stale: false.
func TestCacheSetThenGet(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "hash-1")

	cache.Set("proj-1", "src/auth", 0, level, 0)

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Fatal("expected cache hit, got nil")
	}
	if result.Stale {
		t.Error("expected stale=false for fresh entry")
	}
	if result.Level.Path != "src/auth" {
		t.Errorf("Level.Path: got %q, want %q", result.Level.Path, "src/auth")
	}
	if result.Level.SourceHash != "hash-1" {
		t.Errorf("Level.SourceHash: got %q, want %q", result.Level.SourceHash, "hash-1")
	}
}

// TestCacheDifferentDepth_Miss tests AC#4: Same path but different depth is a cache miss.
func TestCacheDifferentDepth_Miss(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "hash-1")

	cache.Set("proj-1", "src/auth", 0, level, 0)

	result := cache.Get("proj-1", "src/auth", 1)
	if result != nil {
		t.Error("expected cache miss for different depth, got hit")
	}
}

// TestCacheDifferentProject_Miss verifies same path+depth but different projectId is a miss.
func TestCacheDifferentProject_Miss(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "hash-1")

	cache.Set("proj-1", "src/auth", 0, level, 0)

	result := cache.Get("proj-2", "src/auth", 0)
	if result != nil {
		t.Error("expected cache miss for different projectId, got hit")
	}
}

// --- Behavior 3: TTL and staleness ---

// TestCacheTTL_BeforeExpiry tests: Set with TTL, get before expiry → stale: false.
func TestCacheTTL_BeforeExpiry(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "hash-1")

	cache.Set("proj-1", "src/auth", 0, level, 5000) // 5 second TTL

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Fatal("expected cache hit")
	}
	if result.Stale {
		t.Error("expected stale=false before TTL expiry")
	}
}

// TestCacheTTL_AfterExpiry tests AC#5: After TTL expiration, get() returns level with stale: true.
func TestCacheTTL_AfterExpiry(t *testing.T) {
	cache := NewInMemoryZoomCacheWithClock(newTestClock())
	level := makeTestLevel("src/auth", 0, "hash-1")
	tc := cache.(clockSetter)

	cache.Set("proj-1", "src/auth", 0, level, 100) // 100ms TTL

	// Advance clock past TTL
	tc.AdvanceClock(200 * time.Millisecond)

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Fatal("expected stale data to be returned, got nil")
	}
	if !result.Stale {
		t.Error("expected stale=true after TTL expiry")
	}
	if result.Level.Path != "src/auth" {
		t.Error("stale data should still have correct content")
	}
}

// TestCacheTTL_NoTTL tests: Set with no TTL (0) → never stale.
func TestCacheTTL_NoTTL(t *testing.T) {
	cache := NewInMemoryZoomCacheWithClock(newTestClock())
	level := makeTestLevel("src/auth", 0, "hash-1")
	tc := cache.(clockSetter)

	cache.Set("proj-1", "src/auth", 0, level, 0) // no TTL

	// Advance clock significantly
	tc.AdvanceClock(24 * time.Hour)

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Fatal("expected cache hit")
	}
	if result.Stale {
		t.Error("expected stale=false with no TTL")
	}
}

// TestCacheTTL_ZeroTTL tests: TTL of 0ms → immediately stale.
// Note: this uses an explicit TTL of 1ms (minimum) to distinguish from "no TTL".
// The spec says "TTL of 0 → immediately stale". We test with ttlMs=1 and advance.
func TestCacheTTL_ImmediatelyStale(t *testing.T) {
	cache := NewInMemoryZoomCacheWithClock(newTestClock())
	level := makeTestLevel("src/auth", 0, "hash-1")
	tc := cache.(clockSetter)

	// Use SetWithImmediateStale or a very small TTL
	cache.Set("proj-1", "src/auth", 0, level, 1) // 1ms TTL

	tc.AdvanceClock(2 * time.Millisecond)

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Fatal("expected stale data, got nil")
	}
	if !result.Stale {
		t.Error("expected stale=true for expired TTL")
	}
}

// --- Behavior 4: Hash-based invalidation ---

// TestInvalidateByHash_DifferentHash tests AC#6:
// invalidateByHash() removes entry when sourceHash doesn't match.
func TestInvalidateByHash_DifferentHash(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "old-hash")

	cache.Set("proj-1", "src/auth", 0, level, 0)

	invalidated := cache.InvalidateByHash("proj-1", "src/auth", 0, "new-hash")
	if !invalidated {
		t.Error("expected invalidation when hash differs")
	}

	result := cache.Get("proj-1", "src/auth", 0)
	if result != nil {
		t.Error("expected nil after hash invalidation, got hit")
	}
}

// TestInvalidateByHash_SameHash verifies entry is NOT removed when hash matches.
func TestInvalidateByHash_SameHash(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "same-hash")

	cache.Set("proj-1", "src/auth", 0, level, 0)

	invalidated := cache.InvalidateByHash("proj-1", "src/auth", 0, "same-hash")
	if invalidated {
		t.Error("expected no invalidation when hash matches")
	}

	result := cache.Get("proj-1", "src/auth", 0)
	if result == nil {
		t.Error("expected entry to survive when hash matches")
	}
}

// TestInvalidateByHash_NotStale verifies hash-invalidated entries are removed entirely
// (not served stale).
func TestInvalidateByHash_NotServedStale(t *testing.T) {
	cache := NewInMemoryZoomCache()
	level := makeTestLevel("src/auth", 0, "old-hash")

	cache.Set("proj-1", "src/auth", 0, level, 5000) // has TTL

	cache.InvalidateByHash("proj-1", "src/auth", 0, "new-hash")

	// Should be completely gone, not stale
	result := cache.Get("proj-1", "src/auth", 0)
	if result != nil {
		t.Error("hash-invalidated entry should not be served stale")
	}
}

// --- Behavior 5: Partial invalidation by path ---

// TestInvalidateByPath_SiblingsSurvive tests AC#7:
// invalidateByPath("src/auth") invalidates src/auth but NOT src/api.
func TestInvalidateByPath_SiblingsSurvive(t *testing.T) {
	cache := NewInMemoryZoomCache()

	cache.Set("proj-1", "src/auth", 0, makeTestLevel("src/auth", 0, "h1"), 0)
	cache.Set("proj-1", "src/api", 0, makeTestLevel("src/api", 0, "h2"), 0)
	cache.Set("proj-1", "src/db", 0, makeTestLevel("src/db", 0, "h3"), 0)

	count := cache.InvalidateByPath("proj-1", "src/auth")

	// src/auth should be invalidated
	if cache.Get("proj-1", "src/auth", 0) != nil {
		t.Error("src/auth should be invalidated")
	}

	// src/api should survive
	if cache.Get("proj-1", "src/api", 0) == nil {
		t.Error("src/api should survive")
	}

	// src/db should survive
	if cache.Get("proj-1", "src/db", 0) == nil {
		t.Error("src/db should survive")
	}

	// Count should include at least the direct entry
	if count < 1 {
		t.Errorf("expected at least 1 invalidated, got %d", count)
	}
}

// TestInvalidateByPath_ParentCascade tests AC#8:
// invalidateByPath("src/auth") also invalidates the parent "src/" zoom.
func TestInvalidateByPath_ParentCascade(t *testing.T) {
	cache := NewInMemoryZoomCache()

	// Set parent and child entries
	cache.Set("proj-1", "src/", 0, makeTestLevel("src/", 0, "parent-hash"), 0)
	cache.Set("proj-1", "src/auth", 1, makeTestLevel("src/auth", 1, "child-hash"), 0)
	cache.Set("proj-1", "src/api", 1, makeTestLevel("src/api", 1, "sibling-hash"), 0)

	count := cache.InvalidateByPath("proj-1", "src/auth")

	// Child should be invalidated
	if cache.Get("proj-1", "src/auth", 1) != nil {
		t.Error("src/auth should be invalidated")
	}

	// Parent should also be invalidated (cascade up)
	if cache.Get("proj-1", "src/", 0) != nil {
		t.Error("parent src/ should be invalidated by cascade")
	}

	// Sibling should survive
	if cache.Get("proj-1", "src/api", 1) == nil {
		t.Error("sibling src/api should survive")
	}

	if count < 2 {
		t.Errorf("expected at least 2 invalidated (child + parent), got %d", count)
	}
}

// TestInvalidateByPath_DeepCascade tests deeply nested invalidation propagates up to root.
func TestInvalidateByPath_DeepCascade(t *testing.T) {
	cache := NewInMemoryZoomCache()

	// Set entries at 3 levels: root → subsystem → module
	cache.Set("proj-1", "", 0, makeTestLevel("", 0, "root-hash"), 0)
	cache.Set("proj-1", "src/", 0, makeTestLevel("src/", 0, "src-hash"), 0)
	cache.Set("proj-1", "src/auth", 1, makeTestLevel("src/auth", 1, "auth-hash"), 0)
	cache.Set("proj-1", "src/auth/login", 2, makeTestLevel("src/auth/login", 2, "login-hash"), 0)

	count := cache.InvalidateByPath("proj-1", "src/auth/login")

	// The target should be invalidated
	if cache.Get("proj-1", "src/auth/login", 2) != nil {
		t.Error("src/auth/login should be invalidated")
	}

	// Parent src/auth should be invalidated
	if cache.Get("proj-1", "src/auth", 1) != nil {
		t.Error("src/auth should be invalidated by cascade")
	}

	// Grandparent src/ should be invalidated
	if cache.Get("proj-1", "src/", 0) != nil {
		t.Error("src/ should be invalidated by cascade")
	}

	// Root should be invalidated
	if cache.Get("proj-1", "", 0) != nil {
		t.Error("root should be invalidated by cascade")
	}

	if count < 4 {
		t.Errorf("expected at least 4 invalidated, got %d", count)
	}
}

// TestInvalidateByPath_SiblingChildrenSurvive verifies siblings of the invalidated child survive.
func TestInvalidateByPath_SiblingChildrenSurvive(t *testing.T) {
	cache := NewInMemoryZoomCache()

	cache.Set("proj-1", "src/auth/login", 2, makeTestLevel("src/auth/login", 2, "h1"), 0)
	cache.Set("proj-1", "src/auth/session", 2, makeTestLevel("src/auth/session", 2, "h2"), 0)
	cache.Set("proj-1", "src/auth", 1, makeTestLevel("src/auth", 1, "h3"), 0)

	cache.InvalidateByPath("proj-1", "src/auth/login")

	// Sibling child should survive
	if cache.Get("proj-1", "src/auth/session", 2) == nil {
		t.Error("sibling src/auth/session should survive")
	}
}

// TestInvalidateByPath_ReturnsCount verifies the count of invalidated entries.
func TestInvalidateByPath_ReturnsCount(t *testing.T) {
	cache := NewInMemoryZoomCache()

	cache.Set("proj-1", "src/", 0, makeTestLevel("src/", 0, "h1"), 0)
	cache.Set("proj-1", "src/auth", 1, makeTestLevel("src/auth", 1, "h2"), 0)

	count := cache.InvalidateByPath("proj-1", "src/auth")
	if count != 2 { // src/auth + parent src/
		t.Errorf("expected 2 invalidated, got %d", count)
	}
}

// --- Clear ---

// TestCacheClear tests AC#11: cache.clear(projectId) removes all entries for that project.
func TestCacheClear(t *testing.T) {
	cache := NewInMemoryZoomCache()

	cache.Set("proj-1", "src/auth", 0, makeTestLevel("src/auth", 0, "h1"), 0)
	cache.Set("proj-1", "src/api", 0, makeTestLevel("src/api", 0, "h2"), 0)
	cache.Set("proj-2", "src/auth", 0, makeTestLevel("src/auth", 0, "h3"), 0)

	cache.Clear("proj-1")

	if cache.Get("proj-1", "src/auth", 0) != nil {
		t.Error("proj-1 src/auth should be cleared")
	}
	if cache.Get("proj-1", "src/api", 0) != nil {
		t.Error("proj-1 src/api should be cleared")
	}

	// Different project should not be affected
	if cache.Get("proj-2", "src/auth", 0) == nil {
		t.Error("proj-2 should not be affected by clearing proj-1")
	}
}

// --- Path normalization ---

// TestCachePathNormalization verifies "src/" and "src" are treated consistently.
func TestCachePathNormalization(t *testing.T) {
	cache := NewInMemoryZoomCache()

	cache.Set("proj-1", "src/", 0, makeTestLevel("src/", 0, "h1"), 0)

	// Should find it with or without trailing slash
	result := cache.Get("proj-1", "src", 0)
	if result == nil {
		t.Error("expected cache hit with normalized path (no trailing slash)")
	}

	result2 := cache.Get("proj-1", "src/", 0)
	if result2 == nil {
		t.Error("expected cache hit with trailing slash")
	}
}
