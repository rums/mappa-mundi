import type { Atom } from './resolve.js';
import type { Compound, Reference } from './references.js';
import type { ImportEdge } from '../../types.js';
import type { StructuralPartition } from '../partition.js';

export interface Breadcrumb {
  compoundId: string;
  compoundName: string;
  depth: number;
}

export interface AtomDiff {
  added: string[];
  removed: string[];
  edgesChanged: number;
}

export interface PreviousClustering {
  compounds: Compound[];
}

export function buildClusterPrompt(
  atoms: Atom[],
  edges: ImportEdge[],
  breadcrumbs: Breadcrumb[],
  refs: Reference[],
  structural: StructuralPartition | null,
  prev: PreviousClustering | null,
  diff: AtomDiff | null,
  depth: number,
): string {
  const parts: string[] = [];

  parts.push('# Cluster Prompt');
  parts.push('');

  // Breadcrumb path
  if (breadcrumbs.length > 0) {
    const path = breadcrumbs.map((b) => b.compoundName).join(' > ');
    parts.push(`## Context Path`);
    parts.push(path);
    parts.push('');
  }

  // Atom list
  parts.push('## Atoms');
  for (const atom of atoms) {
    parts.push(`- ${atom.id} (${atom.filePath})`);
  }
  parts.push('');

  // Edges
  if (edges.length > 0) {
    parts.push('## Edges');
    for (const edge of edges) {
      parts.push(`- ${edge.source} -> ${edge.target}`);
    }
    parts.push('');
  }

  // Structural suggestion
  if (structural) {
    parts.push('## Suggested grouping');
    parts.push('You may accept or adjust the following structural suggestion:');
    for (let i = 0; i < structural.clusters.length; i++) {
      parts.push(`- Cluster ${i + 1}: ${structural.clusters[i].join(', ')}`);
    }
    parts.push('');
  } else {
    parts.push('No structural suggestion available.');
    parts.push('');
  }

  // Previous clustering (for differential prompts)
  if (prev) {
    parts.push('## Previous clustering (previous)');
    for (const compound of prev.compounds) {
      parts.push(`- ${compound.name}: ${compound.atomIds.join(', ')}`);
    }
    parts.push('');
  }

  // Diff
  if (diff) {
    parts.push('## Changes since previous');
    if (diff.added.length > 0) parts.push(`Added: ${diff.added.join(', ')}`);
    if (diff.removed.length > 0) parts.push(`Removed: ${diff.removed.join(', ')}`);
    if (diff.edgesChanged > 0) parts.push(`Edges changed: ${diff.edgesChanged}`);
    parts.push('');
  }

  return parts.join('\n');
}
