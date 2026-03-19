/**
 * Behavior 6: Progress guard
 *
 * Tests that the system detects and handles no-progress LLM responses.
 *
 * AC covered: #8
 */

import { describe, it, expect, vi } from 'vitest';
import { buildStratum } from '../../../src/interpret/stratum';
import type { ZoomConfig, LLMClient, LLMResponse } from './types';
import { buildProject, createMockStratumCache, DEFAULT_CONFIG, createSuccessLLM } from './helpers';

describe('Progress guard', () => {
  it('should retry when LLM returns 1 compound with all atoms, then fallback (AC#8)', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);
    const config: ZoomConfig = { minCompoundSize: 6, maxStratumDepth: 5, maxRetries: 2 };

    // LLM always returns all atoms in one compound
    const llm: LLMClient = {
      complete: vi.fn().mockResolvedValue({
        content: {
          compounds: [
            { name: 'Everything', summary: 'All', atomIds, references: [] },
          ],
        },
        usage: { promptTokens: 1000, completionTokens: 100 },
      } satisfies LLMResponse),
    };
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], config, llm, cache, 'proj', 'file');

    // Should have retried (1 initial + 2 retries = 3 calls)
    expect(llm.complete).toHaveBeenCalledTimes(3);

    // After retries exhausted → fallback → multiple compounds
    expect(stratum.compounds.length).toBeGreaterThan(1);
  });

  it('should accept LLM response with 2 compounds (minimum for progress)', async () => {
    const { graph, atoms } = buildProject(12, 2);
    const atomIds = atoms.map((a) => a.id);

    const llm = createSuccessLLM([
      { name: 'A', summary: 'A', atomIds: atomIds.slice(0, 6) },
      { name: 'B', summary: 'B', atomIds: atomIds.slice(6) },
    ]);
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    expect(stratum.compounds.length).toBe(2);
    // Should only call LLM once (accepted on first try)
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('should accept 6 compounds for a zoom (above 2-5 range) with a log, not retry', async () => {
    const { graph, atoms } = buildProject(30, 6);
    const atomIds = atoms.map((a) => a.id);

    // Return 6 sub-compounds when zooming (above typical 2-5 range)
    const llm = createSuccessLLM(
      Array.from({ length: 6 }, (_, i) => ({
        name: `Group ${i}`,
        summary: `Group ${i}`,
        atomIds: atomIds.slice(i * 5, (i + 1) * 5),
      })),
    );
    const cache = createMockStratumCache();

    const stratum = await buildStratum(null, atoms, graph.edges, [], DEFAULT_CONFIG, llm, cache, 'proj', 'file');

    // Should be accepted (not retried for count)
    expect(stratum.compounds.length).toBe(6);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });
});
