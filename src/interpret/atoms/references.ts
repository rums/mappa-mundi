import type { ImportEdge } from '../../types.js';

export interface Reference {
  atomId: string;
  weight: number;
}

export interface Compound {
  id: string;
  name: string;
  summary: string;
  atomIds: string[];
  references: Reference[];
  zoomable: boolean;
  doi?: number;
}

export function computeReferenceWeights(compound: Compound, edges: ImportEdge[]): Reference[] {
  const atomSet = new Set(compound.atomIds);

  // Find all external edges (source in compound, target NOT in compound)
  const externalEdges = edges.filter(
    (e) => atomSet.has(e.source) && !atomSet.has(e.target),
  );

  if (externalEdges.length === 0) return [];

  const refAtomIds = new Set(compound.references.map((r) => r.atomId));

  // Count edges to each referenced atom
  const edgeCounts = new Map<string, number>();
  for (const edge of externalEdges) {
    if (refAtomIds.has(edge.target)) {
      edgeCounts.set(edge.target, (edgeCounts.get(edge.target) || 0) + 1);
    }
  }

  const totalExternal = externalEdges.length;
  const result: Reference[] = [];

  for (const ref of compound.references) {
    const count = edgeCounts.get(ref.atomId) || 0;
    const weight = count / totalExternal;
    if (weight > 0) {
      result.push({ atomId: ref.atomId, weight });
    }
  }

  return result;
}
