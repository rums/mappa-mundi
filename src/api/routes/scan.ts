import type { FastifyInstance } from 'fastify';
import { existsSync, statSync, realpathSync } from 'fs';
import { resolve } from 'path';
import type { Orchestrator } from '../orchestrator.js';
import { scan } from '../../scanner.js';
import { buildDirectoryTree } from '../../directory-tree.js';
import { buildFallback } from '../../interpret/fallback.js';

export function runScanPipeline(orchestrator: Orchestrator, jobId: string, projectPath: string): void {
  // Fire and forget - don't await
  const pipeline = async () => {
    try {
      const graph = await scan(projectPath);
      const dirTree = await buildDirectoryTree(projectPath, graph);
      const zoomLevel = buildFallback(graph, dirTree);

      orchestrator.setLastGraph(graph);
      orchestrator.setLastDirTree(dirTree);
      orchestrator.setLastZoomLevel(zoomLevel);

      orchestrator.updateJobStatus(jobId, 'completed', { result: zoomLevel });
    } catch (err: any) {
      orchestrator.updateJobStatus(jobId, 'failed', {
        error: err?.message || 'Scan failed',
      });
    }
  };

  // Use setTimeout so fake timers can control pipeline start
  setTimeout(() => { pipeline(); }, 0);
}

export function registerScanRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.post('/api/scan', async (request, reply) => {
    const body = request.body as any;

    if (!body || !body.projectPath) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'projectPath is required' },
      });
    }

    const projectPath: string = body.projectPath;

    // Check for path traversal (reject relative paths with '..')
    if (projectPath.includes('..')) {
      return reply.status(400).send({
        error: { code: 'INVALID_PATH', message: 'Path traversal is not allowed' },
      });
    }

    // Resolve to absolute path
    const resolvedPath = resolve(projectPath);

    // Check path exists
    if (!existsSync(resolvedPath)) {
      return reply.status(400).send({
        error: { code: 'PATH_NOT_FOUND', message: 'Path does not exist' },
      });
    }

    // Check path is a directory and resolve symlinks
    try {
      const realPath = realpathSync(resolvedPath);
      const stat = statSync(realPath);
      if (!stat.isDirectory()) {
        return reply.status(400).send({
          error: { code: 'NOT_A_DIRECTORY', message: 'projectPath must be a directory' },
        });
      }
    } catch {
      return reply.status(400).send({
        error: { code: 'INVALID_PATH', message: 'Cannot access path' },
      });
    }

    // Check if scan already in progress
    if (orchestrator.isScanInProgress()) {
      return reply.status(409).send({
        error: { code: 'SCAN_IN_PROGRESS', message: 'A scan is already in progress' },
      });
    }

    const job = orchestrator.createJob('scan');
    orchestrator.setActiveProjectPath(projectPath);

    // Fire and forget the scan pipeline
    runScanPipeline(orchestrator, job.id, projectPath);

    return reply.status(202).send({
      jobId: job.id,
      status: 'queued',
    });
  });
}
