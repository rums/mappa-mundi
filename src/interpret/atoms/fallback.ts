import type { Atom } from './resolve.js';
import type { Compound, Reference } from './references.js';
import type { ImportEdge } from '../../types.js';
import type { DirectoryNode } from '../../directory-tree.js';
import type { StructuralPartition } from '../partition.js';
import { compoundId } from './ids.js';

export type { StructuralPartition };

export function fallbackStratum(
  atoms: Atom[],
  edges: ImportEdge[],
  partition: StructuralPartition | null,
  dirTree: DirectoryNode,
): Compound[] {
  // Tier 1: use structural partition if provided
  if (partition) {
    return partition.clusters.map((cluster, i) => ({
      id: compoundId(cluster),
      name: `Group ${i + 1}`,
      summary: '',
      atomIds: cluster,
      references: [],
      zoomable: true,
    }));
  }

  // Tier 2: group by immediate parent directory
  const dirGroups = groupByDirectory(atoms);

  if (dirGroups.size > 1) {
    const compounds: Compound[] = [];
    for (const [dirName, groupAtoms] of dirGroups) {
      const atomIds = groupAtoms.map((a) => a.id);
      compounds.push({
        id: compoundId(atomIds),
        name: dirName,
        summary: '',
        atomIds,
        references: [],
        zoomable: true,
      });
    }
    return compounds;
  }

  // Tier 3: flat split into groups of ~6
  return flatSplit(atoms);
}

function groupByDirectory(atoms: Atom[]): Map<string, Atom[]> {
  const groups = new Map<string, Atom[]>();
  for (const atom of atoms) {
    const parts = atom.id.split('/');
    // Get the immediate parent directory
    const dir = parts.length > 1 ? parts[parts.length - 2] : 'root';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(atom);
  }
  return groups;
}

function flatSplit(atoms: Atom[]): Compound[] {
  const groupCount = Math.ceil(atoms.length / 6);
  const baseSize = Math.floor(atoms.length / groupCount);
  const remainder = atoms.length % groupCount;
  const compounds: Compound[] = [];

  let offset = 0;
  for (let i = 0; i < groupCount; i++) {
    // First `remainder` groups get baseSize+1, rest get baseSize
    const size = baseSize + (i < remainder ? 1 : 0);
    const groupAtoms = atoms.slice(offset, offset + size);
    offset += size;
    const atomIds = groupAtoms.map((a) => a.id);
    compounds.push({
      id: compoundId(atomIds),
      name: `Group ${i + 1}`,
      summary: '',
      atomIds,
      references: [],
      zoomable: true,
    });
  }

  return compounds;
}
