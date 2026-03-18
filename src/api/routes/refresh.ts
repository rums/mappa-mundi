import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';
import { runScanPipeline } from './scan.js';

export function registerRefreshRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.post('/api/refresh', async (_request, reply) => {
    const projectPath = orchestrator.getActiveProjectPath();
    if (!projectPath) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    // Prevent concurrent scans/refreshes
    if (orchestrator.isScanInProgress()) {
      return reply.status(409).send({
        error: { code: 'SCAN_IN_PROGRESS', message: 'A scan or refresh is already in progress' },
      });
    }

    const job = orchestrator.createJob('refresh');

    // Fire and forget the scan pipeline using stored project path
    runScanPipeline(orchestrator, job.id, projectPath);

    return reply.status(202).send({
      jobId: job.id,
      status: 'queued',
    });
  });
}
