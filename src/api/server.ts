import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Orchestrator } from './orchestrator.js';
import { registerScanRoutes } from './routes/scan.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerZoomRoutes } from './routes/zoom.js';
import { registerLayerRoutes, createLayerRegistry } from './routes/layers.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerRefreshRoutes } from './routes/refresh.js';
import { registerLensRoutes } from './routes/lenses.js';
import { LensStore } from '../lenses/store.js';

export async function createApp() {
  const app = Fastify({ pluginTimeout: 0 });

  // CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      // Allow localhost origins
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
  });

  // Custom error handler for consistent error format
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode || 500;
    const response: any = {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    };

    // Never include stack
    reply.status(statusCode).send(response);
  });

  // 404 handler for unknown routes
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  const orchestrator = new Orchestrator();
  const layerRegistry = createLayerRegistry();
  const lensStore = new LensStore();

  registerScanRoutes(app, orchestrator, lensStore);
  registerJobRoutes(app, orchestrator);
  registerZoomRoutes(app, orchestrator);
  registerLayerRoutes(app, orchestrator, layerRegistry, lensStore);
  registerSearchRoutes(app, orchestrator);
  registerRefreshRoutes(app, orchestrator);
  registerLensRoutes(app, lensStore);

  // Project list and load
  app.get('/api/projects', async (_request, reply) => {
    return reply.send({ projects: orchestrator.listProjects() });
  });

  app.post('/api/projects/load', async (request, reply) => {
    const { path } = request.body as { path: string };
    if (!path) {
      return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'path is required' } });
    }
    const loaded = orchestrator.loadProject(path);
    if (!loaded) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    return reply.send({ loaded: true, zoomLevel: orchestrator.getLastZoomLevel() });
  });

  return app;
}
