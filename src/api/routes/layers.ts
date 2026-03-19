import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';
import { LayerRegistry } from '../../layers/registry.js';
import { ComplexityLayer } from '../../layers/complexity-layer.js';
import { GitStalenessLayer } from '../../layers/staleness-layer.js';
import { TestCoverageLayer } from '../../layers/coverage-layer.js';
import type { LensStore } from '../../lenses/store.js';
import { evaluateLayerLens } from '../../lenses/layer-evaluator.js';
import { createLLMClient } from '../llm-client.js';

export function createLayerRegistry(): LayerRegistry {
  const registry = new LayerRegistry();
  registry.register(new ComplexityLayer());
  registry.register(new GitStalenessLayer());
  registry.register(new TestCoverageLayer());
  return registry;
}

export function registerLayerRoutes(app: FastifyInstance, orchestrator: Orchestrator, registry: LayerRegistry, lensStore?: LensStore): void {
  app.get('/api/layers', async (_request, reply) => {
    const computedLayers = registry.list().map(l => ({
      id: l.id,
      name: l.name,
      description: l.description,
      source: 'computed' as const,
    }));

    // Include layer lenses
    const lensLayers = (lensStore?.list('layer') ?? []).map(l => ({
      id: l.id,
      name: l.name,
      description: l.prompt.slice(0, 100) + (l.prompt.length > 100 ? '...' : ''),
      source: 'lens' as const,
    }));

    return reply.status(200).send({ layers: [...computedLayers, ...lensLayers] });
  });

  app.get('/api/layers/:layerId', async (request, reply) => {
    const { layerId } = request.params as { layerId: string };
    const { regionId } = request.query as { regionId?: string };

    // Check if this is a layer lens (LLM-powered)
    const lens = lensStore?.get(layerId);
    if (lens && lens.type === 'layer') {
      const zoomLevel = orchestrator.getLastZoomLevel();
      const regionModuleMap = orchestrator.getRegionModuleMap();

      if (!zoomLevel) {
        return reply.status(200).send({ layerId, moduleScores: {} });
      }

      const llm = createLLMClient();
      if (!llm) {
        return reply.status(503).send({
          error: { code: 'LLM_UNAVAILABLE', message: 'LLM is not available for layer lens evaluation' },
        });
      }

      try {
        const result = await evaluateLayerLens(lens.prompt, zoomLevel, regionModuleMap ?? {}, llm);
        return reply.status(200).send({ layerId, moduleScores: result.moduleScores });
      } catch (err: any) {
        return reply.status(500).send({
          error: { code: 'LENS_EVALUATION_FAILED', message: err?.message || 'Layer lens evaluation failed' },
        });
      }
    }

    const layer = registry.get(layerId);
    if (!layer) {
      return reply.status(404).send({
        error: { code: 'LAYER_NOT_FOUND', message: `Layer not found: ${layerId}` },
      });
    }

    const graph = orchestrator.getLastGraph();
    const dirTree = orchestrator.getLastDirTree();

    if (!graph || !dirTree) {
      return reply.status(200).send({
        layerId,
        moduleScores: {},
      });
    }

    const result = layer.computeModuleScores(graph, dirTree);

    // Convert Map to plain object
    let moduleScores: Record<string, any> = {};
    for (const [key, value] of result.moduleScores) {
      moduleScores[key] = value;
    }

    // If regionId is provided, scope to that region's modules
    if (regionId) {
      const zoomLevel = orchestrator.getLastZoomLevel();
      if (zoomLevel) {
        const region = zoomLevel.regions.find(r => r.id === regionId);
        if (region) {
          // Find modules that belong to this region by matching the region name pattern
          // Region IDs are like "region-src", module IDs are like "src/foo.ts"
          const regionName = region.name.toLowerCase();
          const scopedScores: Record<string, any> = {};
          for (const [modId, score] of Object.entries(moduleScores)) {
            if (modId.startsWith(regionName + '/') || modId.startsWith(regionName)) {
              scopedScores[modId] = score;
            }
          }
          moduleScores = scopedScores;
        }
      }
    }

    // Aggregate module scores to region-level scores using regionModuleMap
    const regionModuleMap = orchestrator.getRegionModuleMap();
    const zoomLevel = orchestrator.getLastZoomLevel();
    if (regionModuleMap && zoomLevel) {
      for (const region of zoomLevel.regions) {
        const regionModules = regionModuleMap[region.id] ?? [];
        const regionScoreList = regionModules
          .map((m) => moduleScores[m])
          .filter(Boolean);
        if (regionScoreList.length > 0) {
          // Aggregate: max value, worst severity
          const best = regionScoreList.reduce((a: any, b: any) =>
            a.value > b.value ? a : b, regionScoreList[0]);
          moduleScores[region.id] = best;
        }
      }
    }

    return reply.status(200).send({
      layerId,
      moduleScores,
    });
  });
}
