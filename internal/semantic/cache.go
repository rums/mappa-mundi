package semantic

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// CacheResult wraps a cached zoom level with staleness information.
type CacheResult struct {
	Level SemanticZoomLevel
	Stale bool
}

// ZoomCache defines the interface for caching semantic zoom levels.
type ZoomCache interface {
	Get(projectID, path string, depth int) *CacheResult
	Set(projectID, path string, depth int, level SemanticZoomLevel, ttlMs int)
	InvalidateByHash(projectID, path string, depth int, currentSourceHash string) bool
	InvalidateByPath(projectID, path string) int
	Clear(projectID string)
}

// clock is an internal interface for time sources.
type clock interface {
	Now() time.Time
}

// realClock uses the system clock.
type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// cacheEntry stores a cached zoom level along with TTL metadata.
type cacheEntry struct {
	level     SemanticZoomLevel
	storedAt  time.Time
	ttlMs     int // 0 means no TTL (never stale)
}

// clockAdvancer is an optional interface for clocks that support time advancement (testing).
type clockAdvancer interface {
	Advance(d time.Duration)
}

// inMemoryZoomCache is a thread-safe in-memory implementation of ZoomCache.
type inMemoryZoomCache struct {
	mu      sync.RWMutex
	clk     clock
	entries map[string]*cacheEntry
}

// NewInMemoryZoomCache creates a cache using the real system clock.
func NewInMemoryZoomCache() ZoomCache {
	return &inMemoryZoomCache{
		clk:     realClock{},
		entries: make(map[string]*cacheEntry),
	}
}

// NewInMemoryZoomCacheWithClock creates a cache using an injectable clock.
func NewInMemoryZoomCacheWithClock(clk clock) ZoomCache {
	return &inMemoryZoomCache{
		clk:     clk,
		entries: make(map[string]*cacheEntry),
	}
}

// AdvanceClock delegates to the underlying clock if it supports time advancement.
// This satisfies the clockSetter interface used in tests.
func (c *inMemoryZoomCache) AdvanceClock(d time.Duration) {
	if adv, ok := c.clk.(clockAdvancer); ok {
		adv.Advance(d)
	}
}

// normalizePath strips a trailing slash unless the path is empty.
func normalizePath(path string) string {
	if path == "" {
		return ""
	}
	return strings.TrimRight(path, "/")
}

// cacheKey builds a unique key from projectID, normalized path, and depth.
func cacheKey(projectID, path string, depth int) string {
	return fmt.Sprintf("%s\x00%s\x00%d", projectID, normalizePath(path), depth)
}

// cacheKeyPrefix returns the prefix for all entries belonging to a project.
func cacheKeyPrefix(projectID string) string {
	return projectID + "\x00"
}

func (c *inMemoryZoomCache) Get(projectID, path string, depth int) *CacheResult {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := cacheKey(projectID, path, depth)
	entry, ok := c.entries[key]
	if !ok {
		return nil
	}

	stale := false
	if entry.ttlMs > 0 {
		expiresAt := entry.storedAt.Add(time.Duration(entry.ttlMs) * time.Millisecond)
		if c.clk.Now().After(expiresAt) {
			stale = true
		}
	}

	return &CacheResult{
		Level: entry.level,
		Stale: stale,
	}
}

func (c *inMemoryZoomCache) Set(projectID, path string, depth int, level SemanticZoomLevel, ttlMs int) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(projectID, path, depth)
	c.entries[key] = &cacheEntry{
		level:    level,
		storedAt: c.clk.Now(),
		ttlMs:    ttlMs,
	}
}

func (c *inMemoryZoomCache) InvalidateByHash(projectID, path string, depth int, currentSourceHash string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(projectID, path, depth)
	entry, ok := c.entries[key]
	if !ok {
		return false
	}

	if entry.level.SourceHash != currentSourceHash {
		delete(c.entries, key)
		return true
	}
	return false
}

// parentPaths returns all ancestor paths for a given normalized path.
// For "src/auth/login" it returns ["src/auth", "src", ""].
func parentPaths(path string) []string {
	var parents []string
	for {
		idx := strings.LastIndex(path, "/")
		if idx < 0 {
			// path has no slash; parent is root ""
			parents = append(parents, "")
			break
		}
		path = path[:idx]
		parents = append(parents, path)
	}
	return parents
}

func (c *inMemoryZoomCache) InvalidateByPath(projectID, path string) int {
	c.mu.Lock()
	defer c.mu.Unlock()

	norm := normalizePath(path)
	prefix := cacheKeyPrefix(projectID)

	// Collect all normalized paths to invalidate: the target + all ancestors.
	pathsToInvalidate := map[string]bool{norm: true}
	for _, p := range parentPaths(norm) {
		pathsToInvalidate[p] = true
	}

	count := 0
	for key := range c.entries {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		// Extract the path portion from the key: "projectID\x00path\x00depth"
		rest := key[len(prefix):]
		sepIdx := strings.LastIndex(rest, "\x00")
		if sepIdx < 0 {
			continue
		}
		entryPath := rest[:sepIdx]
		if pathsToInvalidate[entryPath] {
			delete(c.entries, key)
			count++
		}
	}

	return count
}

func (c *inMemoryZoomCache) Clear(projectID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	prefix := cacheKeyPrefix(projectID)
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
}
