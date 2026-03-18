import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';

export function registerZoomRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.get('/api/zoom/:regionId', async (request, reply) => {
    const { regionId } = request.params as { regionId: string };

    if (!orchestrator.getActiveProjectPath()) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    const zoomLevel = orchestrator.getLastZoomLevel();
    if (!zoomLevel) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    // Check if region exists
    const region = zoomLevel.regions.find(r => r.id === regionId);
    if (!region) {
      return reply.status(404).send({
        error: { code: 'REGION_NOT_FOUND', message: `Region not found: ${regionId}` },
      });
    }

    // Return cached zoom data - create a sub-level from the region
    const subLevel = {
      id: regionId,
      label: region.name,
      regions: [],
      relationships: [],
    };

    return reply.status(200).send({
      level: subLevel,
      cached: true,
    });
  });
}
