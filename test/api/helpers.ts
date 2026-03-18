/**
 * Shared test helpers for Analysis API tests.
 *
 * These helpers create mock dependencies and a configured Fastify app
 * for integration-style testing of the API routes.
 */
import { vi } from 'vitest';
import type { SemanticZoomLevel, Region, Relationship, DependencyGraph, ModuleNode } from '../../src/types.js';
import type { LayerScore } from '../../src/layers/types.js';

// ─── Types that will be created in src/api/ ─────────────────────────────────

/**
 * Represents the app factory function signature.
 * The real implementation will be in src/api/server.ts.
 */
export type CreateApp = typeof import('../../src/api/server.js')['createApp'];

/**
 * Job status union — the orchestrator tracks scan/refresh jobs.
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

/**
 * SearchResult — returned by the search endpoint.
 */
export interface SearchResult {
  id: string;
  name: string;
  kind: 'module' | 'region' | 'symbol';
  score: number;
  context?: string;
}

// ─── Test Data Builders ─────────────────────────────────────────────────────

export function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'region-auth',
    name: 'Authentication',
    moduleCount: 3,
    loc: 450,
    ...overrides,
  };
}

export function makeZoomLevel(overrides: Partial<SemanticZoomLevel> = {}): SemanticZoomLevel {
  return {
    id: 'top-level',
    label: 'Project Overview',
    regions: [
      makeRegion({ id: 'region-auth', name: 'Authentication' }),
      makeRegion({ id: 'region-api', name: 'API Layer', moduleCount: 2, loc: 300 }),
      makeRegion({ id: 'region-db', name: 'Data Layer', moduleCount: 2, loc: 200 }),
    ],
    relationships: [
      { sourceId: 'region-api', targetId: 'region-auth', kind: 'depends-on', edgeCount: 2 },
      { sourceId: 'region-api', targetId: 'region-db', kind: 'depends-on', edgeCount: 1 },
    ],
    ...overrides,
  };
}

export function makeModuleNode(id: string): ModuleNode {
  return {
    id,
    filePath: `/test-project/${id}`,
    exports: [],
    symbols: [{ name: 'default', kind: 'function', signature: '(): void', exported: true }],
  };
}

export function makeGraph(): DependencyGraph {
  return {
    root: '/test-project',
    nodes: [
      makeModuleNode('src/auth/login.ts'),
      makeModuleNode('src/auth/session.ts'),
      makeModuleNode('src/api/routes.ts'),
      makeModuleNode('src/api/handler.ts'),
      makeModuleNode('src/db/connection.ts'),
    ],
    edges: [
      { source: 'src/api/handler.ts', target: 'src/auth/session.ts', imports: [{ name: 'Session', kind: 'named' }] },
      { source: 'src/api/handler.ts', target: 'src/db/connection.ts', imports: [{ name: 'connect', kind: 'named' }] },
    ],
  };
}

export function makeLayerScore(overrides: Partial<LayerScore> = {}): LayerScore {
  return {
    value: 0.7,
    raw: 14,
    label: 'Medium',
    severity: 'warning',
    ...overrides,
  };
}
