import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';
import { LayerRegistry } from '../../layers/registry.js';
import { ComplexityLayer } from '../../layers/complexity-layer.js';
import { GitStalenessLayer } from '../../layers/staleness-layer.js';
import { TestCoverageLayer } from '../../layers/coverage-layer.js';

export function createLayerRegistry(): LayerRegistry {
  const registry = new LayerRegistry();
  registry.register(new ComplexityLayer());
  registry.register(new GitStalenessLayer());
  registry.register(new TestCoverageLayer());
  return registry;
}

export function registerLayerRoutes(app: FastifyInstance, orchestrator: Orchestrator, registry: LayerRegistry): void {
  app.get('/api/layers', async (_request, reply) => {
    const layers = registry.list().map(l => ({
      id: l.id,
      name: l.name,
      description: l.description,
    }));

    return reply.status(200).send({ layers });
  });

  app.get('/api/layers/:layerId', async (request, reply) => {
    const { layerId } = request.params as { layerId: string };
    const { regionId } = request.query as { regionId?: string };

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

    return reply.status(200).send({
      layerId,
      moduleScores,
    });
  });
}
