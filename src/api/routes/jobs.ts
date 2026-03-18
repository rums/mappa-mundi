import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';

export function registerJobRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.get('/api/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    // Cleanup expired jobs before looking up
    orchestrator.cleanupExpiredJobs();

    const job = orchestrator.getJob(jobId);
    if (!job) {
      return reply.status(404).send({
        error: { code: 'JOB_NOT_FOUND', message: `Job not found: ${jobId}` },
      });
    }

    const response: any = {
      jobId: job.id,
      status: job.status,
      startedAt: job.startedAt,
    };

    if (job.result !== undefined) {
      response.result = job.result;
    }

    if (job.error !== undefined) {
      response.error = job.error;
    }

    return reply.status(200).send(response);
  });
}
