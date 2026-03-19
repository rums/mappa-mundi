import type { FastifyInstance } from 'fastify';
import { existsSync, statSync, realpathSync } from 'fs';
import { resolve } from 'path';
import type { Orchestrator } from '../orchestrator.js';
import type { LLMClient } from '../../interpret/cluster.js';
import { scan } from '../../scanner.js';
import { buildDirectoryTree } from '../../directory-tree.js';
import { buildFallback } from '../../interpret/fallback.js';
import { clusterTopLevel } from '../../interpret/cluster.js';
import { createLLMClient } from '../llm-client.js';

export function runScanPipeline(orchestrator: Orchestrator, jobId: string, projectPath: string): void {
  // Fire and forget - don't await
  const pipeline = async () => {
    try {
      orchestrator.updateJobStatus(jobId, 'running');
      const graph = await scan(projectPath);
      const dirTree = await buildDirectoryTree(projectPath, graph);

      // Try LLM-powered clustering, fall back to directory-based grouping
      const llm = createLLMClient();
      let zoomLevel;
      if (llm) {
        try {
          console.log('[scan] Attempting LLM clustering...');
          zoomLevel = await clusterTopLevel(graph, dirTree, llm);
          console.log('[scan] LLM clustering produced', zoomLevel.regions.length, 'regions');
        } catch (llmErr: any) {
          console.log('[scan] LLM clustering failed:', llmErr?.message || llmErr);
          zoomLevel = buildFallback(graph, dirTree);
        }
      } else {
        zoomLevel = buildFallback(graph, dirTree);
      }

      // Build region → module map for zoom support
      // For directory-based regions, match by directory path prefix
      // For LLM-clustered regions, we reconstruct from directory names
      const regionModuleMap: Record<string, string[]> = {};
      const allModuleIds = graph.nodes.map((n) => n.id);
      const assigned = new Set<string>();

      for (const region of zoomLevel.regions) {
        // Try to find a matching directory in dirTree
        const regionName = region.name.toLowerCase();
        const matchingChild = dirTree.children.find(
          (c) => c.name.toLowerCase() === regionName,
        );
        if (matchingChild) {
          const dirPath = matchingChild.path.endsWith('/') ? matchingChild.path : matchingChild.path + '/';
          const modules = allModuleIds.filter((id) => id.startsWith(dirPath));
          regionModuleMap[region.id] = modules;
          for (const m of modules) assigned.add(m);
        }
      }
      // Any unassigned modules go into their closest region match
      const unassigned = allModuleIds.filter((id) => !assigned.has(id));
      if (unassigned.length > 0) {
        // Try to match by region name appearing in module path
        for (const moduleId of unassigned) {
          let matched = false;
          for (const region of zoomLevel.regions) {
            const regionName = region.name.toLowerCase().replace(/\s+/g, '-');
            if (moduleId.toLowerCase().includes(regionName)) {
              (regionModuleMap[region.id] ??= []).push(moduleId);
              matched = true;
              break;
            }
          }
          // If still unmatched, put in first region
          if (!matched && zoomLevel.regions.length > 0) {
            const firstId = zoomLevel.regions[zoomLevel.regions.length - 1].id;
            (regionModuleMap[firstId] ??= []).push(moduleId);
          }
        }
      }

      orchestrator.setLastGraph(graph);
      orchestrator.setLastDirTree(dirTree);
      orchestrator.setLastZoomLevel(zoomLevel);
      orchestrator.setRegionModuleMap(regionModuleMap);

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
