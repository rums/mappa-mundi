import type { FastifyInstance } from 'fastify';
import { LensStore } from '../../lenses/store.js';
import type { LensType } from '../../lenses/types.js';

export function registerLensRoutes(app: FastifyInstance, lensStore: LensStore): void {
  // List all lenses, optionally filtered by type
  app.get('/api/lenses', async (request, reply) => {
    const { type } = request.query as { type?: LensType };

    if (type && type !== 'compound' && type !== 'layer') {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'type must be "compound" or "layer"' },
      });
    }

    const lenses = lensStore.list(type);
    return reply.send({ lenses });
  });

  // Get a single lens
  app.get('/api/lenses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lens = lensStore.get(id);

    if (!lens) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Lens not found: ${id}` },
      });
    }

    return reply.send({ lens });
  });

  // Create a new lens
  app.post('/api/lenses', async (request, reply) => {
    const body = request.body as any;

    if (!body?.name || !body?.type || !body?.prompt) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'name, type, and prompt are required' },
      });
    }

    if (body.type !== 'compound' && body.type !== 'layer') {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'type must be "compound" or "layer"' },
      });
    }

    const lens = lensStore.create(body.name, body.type, body.prompt);
    return reply.status(201).send({ lens });
  });

  // Delete a lens
  app.delete('/api/lenses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = lensStore.delete(id);

    if (!deleted) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Lens not found: ${id}` },
      });
    }

    return reply.send({ deleted: true });
  });
}
