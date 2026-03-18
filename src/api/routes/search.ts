import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../orchestrator.js';

interface SearchResult {
  id: string;
  name: string;
  kind: 'module' | 'region' | 'symbol';
  score: number;
  context?: string;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 1.0;
  if (t.includes(q)) return 0.8;

  // Check individual words
  const words = q.split(/\s+/);
  let matched = 0;
  for (const word of words) {
    if (t.includes(word)) matched++;
  }
  if (words.length > 0 && matched > 0) {
    return 0.5 * (matched / words.length);
  }

  return 0;
}

export function registerSearchRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.get('/api/search', async (request, reply) => {
    const { q, maxResults, enableLLM } = request.query as {
      q?: string;
      maxResults?: string;
      enableLLM?: string;
    };

    if (!orchestrator.getActiveProjectPath()) {
      return reply.status(400).send({
        error: { code: 'NO_PROJECT', message: 'No project scanned' },
      });
    }

    const query = q || '';
    if (!query) {
      return reply.status(200).send({ query, results: [] });
    }

    const limit = maxResults ? parseInt(maxResults, 10) : 50;
    const results: SearchResult[] = [];

    const graph = orchestrator.getLastGraph();
    const zoomLevel = orchestrator.getLastZoomLevel();

    // Search modules
    if (graph) {
      for (const node of graph.nodes) {
        const score = fuzzyScore(query, node.id);
        if (score > 0) {
          results.push({
            id: node.id,
            name: node.id,
            kind: 'module',
            score,
          });
        }

        // Search symbols within the module
        for (const sym of node.symbols) {
          const symScore = fuzzyScore(query, sym.name);
          if (symScore > 0) {
            results.push({
              id: `${node.id}#${sym.name}`,
              name: sym.name,
              kind: 'symbol',
              score: symScore,
              context: node.id,
            });
          }
        }
      }
    }

    // Search regions
    if (zoomLevel) {
      for (const region of zoomLevel.regions) {
        const score = fuzzyScore(query, region.name);
        if (score > 0) {
          results.push({
            id: region.id,
            name: region.name,
            kind: 'region',
            score,
          });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    const limited = results.slice(0, limit);

    return reply.status(200).send({ query, results: limited });
  });
}
