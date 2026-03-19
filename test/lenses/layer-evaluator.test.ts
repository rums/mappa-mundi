import { describe, it, expect } from 'vitest';
import { evaluateLayerLens } from '../../src/lenses/layer-evaluator.js';
import type { LLMClient } from '../../src/interpret/cluster.js';
import type { SemanticZoomLevel } from '../../src/types.js';

function makeFakeLLM(scores: Array<{ regionName: string; score: number; reason?: string }>): LLMClient {
  return {
    async complete() {
      return {
        content: { scores },
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}

const zoomLevel: SemanticZoomLevel = {
  id: 'test',
  label: 'Top Level',
  regions: [
    { id: 'region-api', name: 'API', moduleCount: 5, loc: 500 },
    { id: 'region-core', name: 'Core', moduleCount: 10, loc: 1500 },
    { id: 'region-utils', name: 'Utils', moduleCount: 3, loc: 200 },
  ],
  relationships: [],
};

const regionModuleMap: Record<string, string[]> = {
  'region-api': ['src/api/server.ts', 'src/api/routes.ts'],
  'region-core': ['src/core/engine.ts'],
  'region-utils': ['src/utils/helpers.ts'],
};

describe('evaluateLayerLens', () => {
  it('produces module scores from LLM region scores', async () => {
    const llm = makeFakeLLM([
      { regionName: 'API', score: 0.8, reason: 'High exposure' },
      { regionName: 'Core', score: 0.5, reason: 'Medium' },
      { regionName: 'Utils', score: 0.1, reason: 'Low risk' },
    ]);

    const result = await evaluateLayerLens('Rate by risk', zoomLevel, regionModuleMap, llm);

    // Module scores should be set
    expect(result.moduleScores['src/api/server.ts'].value).toBe(0.8);
    expect(result.moduleScores['src/api/routes.ts'].value).toBe(0.8);
    expect(result.moduleScores['src/core/engine.ts'].value).toBe(0.5);
    expect(result.moduleScores['src/utils/helpers.ts'].value).toBe(0.1);

    // Region-level scores too
    expect(result.moduleScores['region-api'].value).toBe(0.8);
  });

  it('clamps scores to 0-1 range', async () => {
    const llm = makeFakeLLM([
      { regionName: 'API', score: 1.5 },
      { regionName: 'Core', score: -0.2 },
    ]);

    const result = await evaluateLayerLens('test', zoomLevel, regionModuleMap, llm);
    expect(result.moduleScores['region-api'].value).toBe(1);
    expect(result.moduleScores['region-core'].value).toBe(0);
  });

  it('assigns severity based on score', async () => {
    const llm = makeFakeLLM([
      { regionName: 'API', score: 0.1 },
      { regionName: 'Core', score: 0.5 },
      { regionName: 'Utils', score: 0.9 },
    ]);

    const result = await evaluateLayerLens('test', zoomLevel, regionModuleMap, llm);
    expect(result.moduleScores['region-api'].severity).toBe('info');
    expect(result.moduleScores['region-core'].severity).toBe('warning');
    expect(result.moduleScores['region-utils'].severity).toBe('critical');
  });

  it('handles case-insensitive region name matching', async () => {
    const llm = makeFakeLLM([
      { regionName: 'api', score: 0.7 },
    ]);

    const result = await evaluateLayerLens('test', zoomLevel, regionModuleMap, llm);
    expect(result.moduleScores['region-api'].value).toBe(0.7);
  });

  it('skips unrecognized region names', async () => {
    const llm = makeFakeLLM([
      { regionName: 'Unknown Region', score: 0.5 },
    ]);

    const result = await evaluateLayerLens('test', zoomLevel, regionModuleMap, llm);
    expect(Object.keys(result.moduleScores)).toHaveLength(0);
  });
});
