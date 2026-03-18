export interface SemanticMap {
  projectId: string;
  projectRoot: string;
  rootZoom: SemanticZoomLevel;
  generatedAt: string;
}

export interface SemanticZoomLevel {
  path: string;
  depth: number;
  regions: SemanticRegion[];
  relationships: SemanticRelationship[];
  sourceHash: string;
  generatedAt: string;
}

export interface SemanticRegion {
  id: string;
  name: string;
  summary: string;
  modules: string[];
  directories: string[];
  regionHash: string;
  childZoom?: SemanticZoomLevel;
}

export interface SemanticRelationship {
  source: string;
  target: string;
  kind: 'depends-on' | 'data-flow' | 'extends' | 'uses';
  edgeCount: number;
  description?: string;
}

export interface CacheResult {
  level: SemanticZoomLevel;
  stale: boolean;
}

export interface ZoomCache {
  get(projectId: string, path: string, depth: number): CacheResult | null;
  set(projectId: string, path: string, depth: number, level: SemanticZoomLevel, ttlMs?: number): void;
  invalidateByPath(projectId: string, pathPrefix: string): number;
  invalidateByHash(projectId: string, path: string, depth: number, currentSourceHash: string): boolean;
  clear(projectId: string): void;
}

interface CacheEntry {
  level: SemanticZoomLevel;
  expiresAt: number | null; // null = never expires
}

function normalizePath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function makeKey(path: string, depth: number): string {
  return `${normalizePath(path)}::${depth}`;
}

function getParentPaths(path: string): string[] {
  const normalized = normalizePath(path);
  const parts = normalized.split('/');
  const parents: string[] = [];
  for (let i = parts.length - 1; i >= 1; i--) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

/** Create an in-memory ZoomCache with TTL, partial path invalidation, and hash-based invalidation. */
export function createInMemoryZoomCache(): ZoomCache {
  // projectId -> (key -> CacheEntry)
  const store = new Map<string, Map<string, CacheEntry>>();

  function getProjectStore(projectId: string): Map<string, CacheEntry> | undefined {
    return store.get(projectId);
  }

  function ensureProjectStore(projectId: string): Map<string, CacheEntry> {
    let ps = store.get(projectId);
    if (!ps) {
      ps = new Map();
      store.set(projectId, ps);
    }
    return ps;
  }

  return {
    get(projectId, path, depth) {
      const ps = getProjectStore(projectId);
      if (!ps) return null;
      const entry = ps.get(makeKey(path, depth));
      if (!entry) return null;

      const stale = entry.expiresAt !== null && Date.now() >= entry.expiresAt;
      return { level: entry.level, stale };
    },

    set(projectId, path, depth, level, ttlMs?) {
      const ps = ensureProjectStore(projectId);
      const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
      ps.set(makeKey(path, depth), { level, expiresAt });
    },

    invalidateByPath(projectId, pathPrefix) {
      const ps = getProjectStore(projectId);
      if (!ps) return 0;

      const normalized = normalizePath(pathPrefix);
      const parents = getParentPaths(pathPrefix);
      const pathsToInvalidate = new Set([normalized, ...parents]);

      let count = 0;
      for (const key of [...ps.keys()]) {
        // key format: "normalizedPath::depth"
        const sep = key.lastIndexOf('::');
        const entryPath = key.substring(0, sep);
        if (pathsToInvalidate.has(entryPath)) {
          ps.delete(key);
          count++;
        }
      }
      return count;
    },

    invalidateByHash(projectId, path, depth, currentSourceHash) {
      const ps = getProjectStore(projectId);
      if (!ps) return false;
      const key = makeKey(path, depth);
      const entry = ps.get(key);
      if (!entry) return false;
      if (entry.level.sourceHash !== currentSourceHash) {
        ps.delete(key);
        return true;
      }
      return false;
    },

    clear(projectId) {
      store.delete(projectId);
    },
  };
}
