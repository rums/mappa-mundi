import type { LLMClient } from '../interpret/cluster.js';
import type { SemanticZoomLevel } from '../types.js';
import type { LayerScore, Severity } from '../layers/types.js';

/**
 * Result of evaluating a layer lens against the current regions.
 */
export interface LayerLensResult {
  moduleScores: Record<string, LayerScore>;
}

/**
 * Evaluate a layer lens prompt against the current semantic regions.
 * The LLM scores each region on a 0-1 scale.
 */
export async function evaluateLayerLens(
  lensPrompt: string,
  zoomLevel: SemanticZoomLevel,
  regionModuleMap: Record<string, string[]>,
  llm: LLMClient,
): Promise<LayerLensResult> {
  const regionDescriptions = zoomLevel.regions
    .map((r) => `- "${r.name}" (${r.moduleCount} modules, ${r.loc} LOC)`)
    .join('\n');

  const prompt = `Analyze these code regions and score each one.

Regions:
${regionDescriptions}

Scoring criteria: ${lensPrompt}

Score each region from 0.0 (lowest) to 1.0 (highest). Output ONLY a JSON object, nothing else:
{"scores":[{"regionName":"ExactRegionName","score":0.5,"reason":"brief reason"}]}

Output the JSON now:`;

  const responseSchema = {
    type: 'object',
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            regionName: { type: 'string' },
            score: { type: 'number' },
            reason: { type: 'string' },
          },
          required: ['regionName', 'score'],
        },
      },
    },
    required: ['scores'],
  };

  const response = await llm.complete(prompt, responseSchema);
  const content = response.content as {
    scores: Array<{ regionName: string; score: number; reason?: string }>;
  };

  // Map region scores to module scores (all modules in a region get the region's score)
  const moduleScores: Record<string, LayerScore> = {};

  for (const regionScore of content.scores) {
    // Find the matching region
    const region = zoomLevel.regions.find(
      (r) => r.name.toLowerCase() === regionScore.regionName.toLowerCase(),
    );
    if (!region) continue;

    const value = Math.max(0, Math.min(1, regionScore.score));
    const severity: Severity =
      value < 0.33 ? 'info' : value < 0.66 ? 'warning' : 'critical';

    const score: LayerScore = {
      value,
      raw: value,
      label: regionScore.reason ?? `${(value * 100).toFixed(0)}%`,
      severity,
    };

    // Apply to all modules in this region
    const modules = regionModuleMap[region.id] ?? [];
    for (const moduleId of modules) {
      moduleScores[moduleId] = score;
    }

    // Also key by region ID for direct region-level lookup
    moduleScores[region.id] = score;
  }

  return { moduleScores };
}
