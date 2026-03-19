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
import type { LensStore } from '../../lenses/store.js';

export interface ScanPipelineOptions {
  compoundLensPrompt?: string;
}

export function runScanPipeline(orchestrator: Orchestrator, jobId: string, projectPath: string, options?: ScanPipelineOptions): void {
  // Fire and forget - don't await
  const pipeline = async () => {
    try {
      orchestrator.updateJobStatus(jobId, 'running');
      const graph = await scan(projectPath);
      const dirTree = await buildDirectoryTree(projectPath, graph);

      // Try LLM-powered clustering, fall back to directory-based grouping
      const llm = createLLMClient();
      let zoomLevel;
      let regionModuleMap: Record<string, string[]> = {};

      if (llm) {
        try {
          console.log('[scan] Attempting LLM clustering...');
          const clusterConfig = options?.compoundLensPrompt
            ? { compoundLensPrompt: options.compoundLensPrompt }
            : undefined;
          const result = await clusterTopLevel(graph, dirTree, llm, clusterConfig);
          zoomLevel = result.zoomLevel;
          regionModuleMap = result.regionModuleMap;
          console.log('[scan] LLM clustering produced', zoomLevel.regions.length, 'regions');
        } catch (llmErr: any) {
          console.log('[scan] LLM clustering failed:', llmErr?.message || llmErr);
          zoomLevel = buildFallback(graph, dirTree);
        }
      } else {
        zoomLevel = buildFallback(graph, dirTree);
      }

      // For fallback (directory-based), build the module map from dir tree
      if (Object.keys(regionModuleMap).length === 0) {
        const allModuleIds = graph.nodes.map((n) => n.id);
        for (const region of zoomLevel.regions) {
          const regionName = region.name.toLowerCase();
          const matchingChild = dirTree.children.find(
            (c) => c.name.toLowerCase() === regionName,
          );
          if (matchingChild) {
            const dirPath = matchingChild.path.endsWith('/') ? matchingChild.path : matchingChild.path + '/';
            regionModuleMap[region.id] = allModuleIds.filter((id) => id.startsWith(dirPath));
          }
        }
      }

      orchestrator.setLastGraph(graph);
      orchestrator.setLastDirTree(dirTree);
      orchestrator.setLastZoomLevel(zoomLevel);
      orchestrator.setRegionModuleMap(regionModuleMap);

      orchestrator.updateJobStatus(jobId, 'completed', { result: zoomLevel });
      orchestrator.saveProject();
    } catch (err: any) {
      orchestrator.updateJobStatus(jobId, 'failed', {
        error: err?.message || 'Scan failed',
      });
    }
  };

  // Use setTimeout so fake timers can control pipeline start
  setTimeout(() => { pipeline(); }, 0);
}

export function registerScanRoutes(app: FastifyInstance, orchestrator: Orchestrator, lensStore?: LensStore): void {
  app.post('/api/scan', async (request, reply) => {
    const body = request.body as any;
    const { compoundLensId } = request.query as { compoundLensId?: string };

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

    // Resolve compound lens if specified
    let scanOptions: ScanPipelineOptions | undefined;
    if (compoundLensId && lensStore) {
      const lens = lensStore.get(compoundLensId);
      if (!lens) {
        return reply.status(400).send({
          error: { code: 'LENS_NOT_FOUND', message: `Compound lens not found: ${compoundLensId}` },
        });
      }
      if (lens.type !== 'compound') {
        return reply.status(400).send({
          error: { code: 'INVALID_LENS_TYPE', message: 'compoundLensId must reference a compound lens' },
        });
      }
      scanOptions = { compoundLensPrompt: lens.prompt };
    }

    const job = orchestrator.createJob('scan');
    orchestrator.setActiveProjectPath(projectPath);

    // Fire and forget the scan pipeline
    runScanPipeline(orchestrator, job.id, projectPath, scanOptions);

    return reply.status(202).send({
      jobId: job.id,
      status: 'queued',
    });
  });
}
