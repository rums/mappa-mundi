/**
 * Behavior 8: Breadcrumb context
 *
 * Tests for breadcrumb denormalization and prompt context.
 *
 * AC covered: #15 (partial — breadcrumbs)
 */

import { describe, it, expect, vi } from 'vitest';
import { buildStratum } from '../../../src/interpret/stratum';
import { buildClusterPrompt } from '../../../src/interpret/atoms/prompt';
import type { Breadcrumb, Compound, ZoomConfig } from './types';
import {
  buildProject,
  createSuccessLLM,
  createMockStratumCache,
  DEFAULT_CONFIG,
  makeAtom,
} from './helpers';

describe('Breadcrumb context', () => {
  it('should include breadcrumbs in stratum 0 (AC#15)', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 6) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(6) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(stratum.breadcrumbs).toBeDefined();
    expect(Array.isArray(stratum.breadcrumbs)).toBe(true);
    // Stratum 0 should have a root breadcrumb
    expect(stratum.breadcrumbs.length).toBeGreaterThanOrEqual(1);
    expect(stratum.breadcrumbs[0].compoundId).toBe('root');
  });

  it('should include parent compound names in deeper strata breadcrumbs', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);

    const parentCompound: Compound = {
      id: 'c-parent',
      name: 'Authentication',
      summary: 'Auth system',
      atomIds,
      references: [],
      zoomable: true,
    };

    const breadcrumbs: Breadcrumb[] = [
      { compoundId: 'root', compoundName: 'Project Root', depth: 0 },
      { compoundId: 'c-parent', compoundName: 'Authentication', depth: 1 },
    ];

    const llm = createSuccessLLM([
      { name: 'Sub A', summary: 'A', atomIds: atomIds.slice(0, 6) },
      { name: 'Sub B', summary: 'B', atomIds: atomIds.slice(6) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(
      parentCompound,
      atoms,
      graph.edges,
      breadcrumbs,
      DEFAULT_CONFIG,
      llm,
      cache,
      'proj',
      'file',
    );

    // Breadcrumbs should include parent path
    expect(stratum.breadcrumbs.length).toBeGreaterThanOrEqual(2);
    const names = stratum.breadcrumbs.map((b) => b.compoundName);
    expect(names).toContain('Project Root');
    expect(names).toContain('Authentication');
  });

  it('should include zoom path in LLM prompt for stratum N+1', () => {
    const atoms = Array.from({ length: 10 }, (_, i) => makeAtom(`src/file${i}.ts`));
    const breadcrumbs: Breadcrumb[] = [
      { compoundId: 'root', compoundName: 'Project', depth: 0 },
      { compoundId: 'c-auth', compoundName: 'Authentication', depth: 1 },
    ];

    const prompt = buildClusterPrompt(
      atoms,
      [], // edges
      breadcrumbs,
      [], // parent references
      null, // structural suggestion
      null, // previous clustering
      null, // atom diff
      2, // depth
    );

    expect(prompt).toContain('Authentication');
    expect(prompt).toContain('Project');
  });

  it('should include long breadcrumb paths without truncation (v1)', () => {
    const atoms = [makeAtom('src/deep/file.ts')];
    const breadcrumbs: Breadcrumb[] = [
      { compoundId: 'root', compoundName: 'Root', depth: 0 },
      { compoundId: 'c-1', compoundName: 'Infrastructure', depth: 1 },
      { compoundId: 'c-2', compoundName: 'Networking', depth: 2 },
      { compoundId: 'c-3', compoundName: 'HTTP Client', depth: 3 },
    ];

    const prompt = buildClusterPrompt(atoms, [], breadcrumbs, [], null, null, null, 4);

    expect(prompt).toContain('Root');
    expect(prompt).toContain('Infrastructure');
    expect(prompt).toContain('Networking');
    expect(prompt).toContain('HTTP Client');
  });
});
