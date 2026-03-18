import type { ImportEdge } from './types';

/**
 * Returns true if the proportion of cross-boundary edges meets or exceeds the threshold.
 * Returns false if total edges is 0.
 */
export function detectBoundary(
  crossBoundaryEdges: number,
  internalEdges: number,
  threshold: number,
): boolean {
  const total = crossBoundaryEdges + internalEdges;
  if (total === 0) return false;
  return crossBoundaryEdges / total >= threshold;
}

/**
 * Compute inbound, outbound, and internal edge counts for a directory path.
 * dirPath should be a relative path like "src/auth".
 */
export function computeEdgeCounts(
  dirPath: string,
  edges: ImportEdge[],
): { inbound: number; outbound: number; internal: number } {
  const prefix = dirPath + '/';
  let inbound = 0;
  let outbound = 0;
  let internal = 0;

  for (const edge of edges) {
    const sourceInside = edge.source.startsWith(prefix);
    const targetInside = edge.target.startsWith(prefix);

    if (sourceInside && targetInside) {
      internal++;
    } else if (sourceInside && !targetInside) {
      outbound++;
    } else if (!sourceInside && targetInside) {
      inbound++;
    }
    // else: neither inside, ignore
  }

  return { inbound, outbound, internal };
}
