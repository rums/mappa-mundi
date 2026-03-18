import { describe, it, expect, vi } from 'vitest';
import { searchWithLLM } from '../../src/search/llm-search';
import type { LLMClient } from '../../src/search/llm-search';
import type { SemanticRegion } from '../../src/semantic-zoom';
import type { SearchResult } from '../../src/search/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

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

// ─── Behavior 3: LLM Search (Layer 3) ──────────────────────────────────────

describe('LLM Search: invocation', () => {
  it('should call LLM with query and region summaries', async () => {
    const regions = [
      makeRegion({ id: 'r1', name: 'Auth', summary: 'Auth system' }),
      makeRegion({ id: 'r2', name: 'API', summary: 'API layer' }),
    ];
    const llm = createSuccessLLM([
      { regionId: 'r1', score: 0.8, explanation: 'Auth matches the query' },
    ]);

    await searchWithLLM('authentication', regions, llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('should return results with matchLayer "llm"', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm = createSuccessLLM([
      { regionId: 'r1', score: 0.7, explanation: 'Semantic match' },
    ]);

    const results = await searchWithLLM('where is auth', regions, llm);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchLayer).toBe('llm');
  });

  it('should normalize LLM scores to 0.4-0.7 range', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm = createSuccessLLM([
      { regionId: 'r1', score: 1.0, explanation: 'Best match' },
    ]);

    const results = await searchWithLLM('query', regions, llm);

    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.4);
    expect(results[0].relevanceScore).toBeLessThanOrEqual(0.7);
  });
});

describe('LLM Search: failure handling', () => {
  it('should return empty array on LLM failure (no error thrown)', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm = createFailingLLM();

    const results = await searchWithLLM('anything', regions, llm);

    expect(results).toEqual([]);
  });

  it('should retry up to 2 times on LLM failure', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm = createFailingLLM();

    await searchWithLLM('anything', regions, llm);

    // initial + 2 retries = 3 total calls
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('should return results from successful retry', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm: LLMClient = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({
          content: { matches: [{ regionId: 'r1', score: 0.6, explanation: 'match' }] },
          usage: { promptTokens: 500, completionTokens: 100 },
        }),
    };

    const results = await searchWithLLM('query', regions, llm);

    expect(results.length).toBe(1);
    expect(results[0].regionId).toBe('r1');
  });
});

describe('LLM Search: explanation', () => {
  it('should include explanation from LLM response', async () => {
    const regions = [makeRegion({ id: 'r1' })];
    const llm = createSuccessLLM([
      { regionId: 'r1', score: 0.7, explanation: 'This region handles authentication logic' },
    ]);

    const results = await searchWithLLM('auth', regions, llm);

    expect(results[0].explanation).toBe('This region handles authentication logic');
  });
});
