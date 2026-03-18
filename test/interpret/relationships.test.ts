import { describe, it, expect } from 'vitest';
import { deriveRelationships } from '../../src/interpret/relationships';
import type { ImportEdge, Relationship } from '../../src/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Map of region ID → module IDs belonging to that region */
type RegionModuleMap = Record<string, string[]>;

function makeEdge(source: string, target: string): ImportEdge {
  return { source, target, imports: [{ name: 'x', kind: 'named' }] };
}

// ─── Behavior 6: Relationship Derivation ────────────────────────────────────

describe('Relationship Derivation', () => {
  it('should aggregate edges between two regions into a single relationship with edgeCount', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts', 'src/auth/session.ts'],
      'region-api': ['src/api/routes.ts', 'src/api/handler.ts'],
    };

    // 10 edges from auth modules to api modules
    const edges: ImportEdge[] = Array.from({ length: 10 }, (_, i) =>
      makeEdge('src/auth/login.ts', 'src/api/routes.ts'),
    );

    const relationships = deriveRelationships(edges, regionModules);

    const authToApi = relationships.find(
      r => r.sourceId === 'region-auth' && r.targetId === 'region-api',
    );
    expect(authToApi).toBeDefined();
    expect(authToApi!.edgeCount).toBe(10);
  });

  it('should create separate relationships for bidirectional edges', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts'],
      'region-api': ['src/api/handler.ts'],
    };

    const edges: ImportEdge[] = [
      makeEdge('src/auth/login.ts', 'src/api/handler.ts'),
      makeEdge('src/api/handler.ts', 'src/auth/login.ts'),
    ];

    const relationships = deriveRelationships(edges, regionModules);

    expect(relationships.length).toBe(2);

    const authToApi = relationships.find(
      r => r.sourceId === 'region-auth' && r.targetId === 'region-api',
    );
    const apiToAuth = relationships.find(
      r => r.sourceId === 'region-api' && r.targetId === 'region-auth',
    );
    expect(authToApi).toBeDefined();
    expect(apiToAuth).toBeDefined();
  });

  it('should not generate relationships for internal edges within a region', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts', 'src/auth/session.ts'],
      'region-api': ['src/api/handler.ts'],
    };

    const edges: ImportEdge[] = [
      // Internal edge within auth region
      makeEdge('src/auth/login.ts', 'src/auth/session.ts'),
    ];

    const relationships = deriveRelationships(edges, regionModules);

    expect(relationships.length).toBe(0);
  });

  it('should produce no relationships for regions with no external edges', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts'],
      'region-api': ['src/api/handler.ts'],
    };

    // No edges at all
    const relationships = deriveRelationships([], regionModules);

    expect(relationships.length).toBe(0);
  });

  it('should set kind to depends-on by default', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts'],
      'region-api': ['src/api/handler.ts'],
    };

    const edges: ImportEdge[] = [
      makeEdge('src/auth/login.ts', 'src/api/handler.ts'),
    ];

    const relationships = deriveRelationships(edges, regionModules);

    expect(relationships[0].kind).toBe('depends-on');
  });

  it('should handle isolated regions (no edges in or out)', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts'],
      'region-api': ['src/api/handler.ts'],
      'region-isolated': ['src/utils/helper.ts'],
    };

    const edges: ImportEdge[] = [
      makeEdge('src/auth/login.ts', 'src/api/handler.ts'),
    ];

    const relationships = deriveRelationships(edges, regionModules);

    // Only one relationship (auth → api), isolated region has none
    expect(relationships.length).toBe(1);
    const isolatedRels = relationships.filter(
      r => r.sourceId === 'region-isolated' || r.targetId === 'region-isolated',
    );
    expect(isolatedRels.length).toBe(0);
  });

  it('should handle edges referencing modules not in any region', () => {
    const regionModules: RegionModuleMap = {
      'region-auth': ['src/auth/login.ts'],
    };

    const edges: ImportEdge[] = [
      // Target module is not in any region
      makeEdge('src/auth/login.ts', 'src/unknown/file.ts'),
    ];

    const relationships = deriveRelationships(edges, regionModules);

    // Edge references unknown module — should not crash, no relationship generated
    expect(relationships.length).toBe(0);
  });
});
