import type { Reference, Compound } from './references.js';
import { compoundId } from './ids.js';

export interface ValidationResult<T = Compound[]> {
  valid: boolean;
  data: T;
  fixes: string[];
}

export interface ZoomConfig {
  minCompoundSize: number;
  maxStratumDepth: number;
  maxRetries: number;
}

interface RawCompound {
  name: string;
  summary: string;
  atomIds: string[];
  references?: string[] | Reference[];
}

interface RawStratum {
  compounds: RawCompound[];
}

export function validateStratum(
  raw: RawStratum,
  inScopeIds: string[],
  allAtomIds: string[],
  depth: number,
  config: ZoomConfig,
): ValidationResult {
  const fixes: string[] = [];
  const inScopeSet = new Set(inScopeIds);
  const allAtomSet = new Set(allAtomIds);
  const assignedAtoms = new Set<string>();

  const compounds: Compound[] = [];

  for (const rawCompound of raw.compounds) {
    const validAtomIds: string[] = [];
    const refs: Reference[] = [];

    // Parse references from raw (can be string[] or Reference[])
    const rawRefs: string[] = [];
    if (rawCompound.references) {
      for (const r of rawCompound.references) {
        if (typeof r === 'string') {
          rawRefs.push(r);
        } else {
          rawRefs.push((r as Reference).atomId);
        }
      }
    }

    // Process atomIds
    for (const atomId of rawCompound.atomIds) {
      if (!inScopeSet.has(atomId)) {
        // Out of scope - move to references if valid
        if (allAtomSet.has(atomId)) {
          refs.push({ atomId, weight: 0 });
          fixes.push(`Moved out-of-scope atom ${atomId} to references`);
        } else {
          fixes.push(`Dropped invalid atom ${atomId}`);
        }
        continue;
      }

      if (assignedAtoms.has(atomId)) {
        // Duplicate - skip (keep first assignment)
        fixes.push(`Removed duplicate atom ${atomId}`);
        continue;
      }

      assignedAtoms.add(atomId);
      validAtomIds.push(atomId);
    }

    // Process references
    for (const refId of rawRefs) {
      // Drop invalid references
      if (!allAtomSet.has(refId)) {
        fixes.push(`Dropped invalid reference ${refId}`);
        continue;
      }
      // Drop references that duplicate atoms in this compound
      if (validAtomIds.includes(refId)) {
        fixes.push(`Dropped reference ${refId} that duplicates atomId`);
        continue;
      }
      // Check not already in refs
      if (!refs.find((r) => r.atomId === refId)) {
        refs.push({ atomId: refId, weight: 0 });
      }
    }

    compounds.push({
      id: compoundId(validAtomIds),
      name: rawCompound.name,
      summary: rawCompound.summary,
      atomIds: validAtomIds,
      references: refs,
      zoomable: true, // will be set properly later
    });
  }

  // Fix orphans: atoms in scope but not assigned to any compound
  const orphans = inScopeIds.filter((id) => !assignedAtoms.has(id));
  if (orphans.length > 0) {
    for (const orphan of orphans) {
      // Find nearest compound by directory proximity
      let bestCompound = compounds[0];
      let bestScore = -1;

      for (const compound of compounds) {
        if (compound.atomIds.length === 0) continue;
        // Score by common path prefix length
        const score = commonPrefixLength(orphan, compound.atomIds[0]);
        if (score > bestScore) {
          bestScore = score;
          bestCompound = compound;
        }
      }

      if (bestCompound) {
        bestCompound.atomIds.push(orphan);
        // Recompute ID
        bestCompound.id = compoundId(bestCompound.atomIds);
        fixes.push(`Assigned orphan ${orphan} to compound ${bestCompound.name}`);
      }
    }
  }

  return {
    valid: true,
    data: compounds,
    fixes,
  };
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
