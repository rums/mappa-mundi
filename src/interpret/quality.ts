import type { ImportEdge } from '../types.js';
import type { Atom } from './atoms/resolve.js';
import type { Compound, Reference } from './atoms/references.js';

export interface StratumQuality {
  mq: number;
  directoryAlignment: number;
  source: 'llm' | 'structural' | 'fallback-directory' | 'fallback-flat';
}

export function computeQuality(
  compounds: Compound[],
  edges: ImportEdge[],
  atoms: Atom[],
  source: 'llm' | 'structural' | 'fallback-directory' | 'fallback-flat',
): StratumQuality {
  const mq = computeMQ(compounds, edges);
  const directoryAlignment = computeDirectoryAlignment(compounds, atoms);

  return { mq, directoryAlignment, source };
}

function computeMQ(compounds: Compound[], edges: ImportEdge[]): number {
  if (compounds.length === 0) return 1;

  // Build atom-to-compound map
  const atomToCompound = new Map<string, string>();
  for (const compound of compounds) {
    for (const atomId of compound.atomIds) {
      atomToCompound.set(atomId, compound.id);
    }
  }

  const k = compounds.length;
  let total = 0;

  for (const compound of compounds) {
    const compoundAtoms = new Set(compound.atomIds);
    let intra = 0;
    let inter = 0;

    for (const edge of edges) {
      const srcIn = compoundAtoms.has(edge.source);
      const tgtIn = compoundAtoms.has(edge.target);

      if (srcIn && tgtIn) {
        intra++;
      } else if (srcIn || tgtIn) {
        inter++;
      }
    }

    if (intra === 0 && inter === 0) {
      // No edges at all for this compound - contribute 1 (no coupling penalty)
      total += 1;
    } else {
      total += intra / (intra + 0.5 * inter);
    }
  }

  return total / k;
}

function computeDirectoryAlignment(compounds: Compound[], atoms: Atom[]): number {
  // Group atoms by immediate parent directory
  const atomDirMap = new Map<string, string>();
  for (const atom of atoms) {
    const parts = atom.id.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
    atomDirMap.set(atom.id, dir);
  }

  // Build directory partition
  const dirGroups = new Map<string, Set<string>>();
  for (const [atomId, dir] of atomDirMap) {
    if (!dirGroups.has(dir)) dirGroups.set(dir, new Set());
    dirGroups.get(dir)!.add(atomId);
  }

  // Build compound partition
  const compoundGroups = new Map<string, Set<string>>();
  for (const compound of compounds) {
    compoundGroups.set(compound.id, new Set(compound.atomIds));
  }

  // Compute similarity (simplified MoJoFM-like score)
  // Count pairs that agree between the two partitions
  const allAtomIds = atoms.map((a) => a.id);
  let agree = 0;
  let total = 0;

  for (let i = 0; i < allAtomIds.length; i++) {
    for (let j = i + 1; j < allAtomIds.length; j++) {
      const a = allAtomIds[i];
      const b = allAtomIds[j];

      const sameDir = atomDirMap.get(a) === atomDirMap.get(b);
      let sameCompound = false;
      for (const group of compoundGroups.values()) {
        if (group.has(a) && group.has(b)) {
          sameCompound = true;
          break;
        }
      }

      if (sameDir === sameCompound) agree++;
      total++;
    }
  }

  if (total === 0) return 100;
  return Math.round((agree / total) * 100);
}

// DOI scoring

export interface DOIContext {
  focusCompoundId: string | null;
  complexityScores: Record<string, number>;
  churnScores: Record<string, number>;
  siblingIds?: string[];
}

export function computeDOI(
  compounds: Compound[],
  context: DOIContext,
): Map<string, number> {
  const result = new Map<string, number>();

  // Find max values for normalization
  const maxAtomCount = Math.max(...compounds.map((c) => c.atomIds.length), 1);

  // Compute per-compound complexity and churn
  const compoundComplexity = new Map<string, number>();
  const compoundChurn = new Map<string, number>();

  for (const compound of compounds) {
    let complexity = 0;
    let churn = 0;
    for (const atomId of compound.atomIds) {
      complexity += context.complexityScores[atomId] ?? 0;
      churn += context.churnScores[atomId] ?? 0;
    }
    compoundComplexity.set(compound.id, complexity);
    compoundChurn.set(compound.id, churn);
  }

  const maxComplexity = Math.max(...[...compoundComplexity.values()], 0);
  const maxChurn = Math.max(...[...compoundChurn.values()], 0);

  const siblingSet = new Set(context.siblingIds ?? []);

  for (const compound of compounds) {
    // IntrinsicInterest
    const atomCountComponent = 0.5 * (compound.atomIds.length / maxAtomCount);
    const complexityComponent = maxComplexity > 0
      ? 0.3 * ((compoundComplexity.get(compound.id) ?? 0) / maxComplexity)
      : 0;
    const churnComponent = maxChurn > 0
      ? 0.2 * ((compoundChurn.get(compound.id) ?? 0) / maxChurn)
      : 0;

    const intrinsicInterest = atomCountComponent + complexityComponent + churnComponent;

    // ProximityToFocus
    let proximity = 0;
    if (context.focusCompoundId === compound.id) {
      proximity = 1.0;
    } else if (siblingSet.has(compound.id)) {
      proximity = 0.3;
    }

    const doi = intrinsicInterest + proximity;
    result.set(compound.id, doi);
  }

  return result;
}
