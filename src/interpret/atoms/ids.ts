import { createHash } from 'node:crypto';
import type { Atom } from './resolve.js';
import type { ImportEdge } from '../../types.js';

export function compoundId(atomIds: string[]): string {
  const sorted = [...atomIds].sort();
  const joined = sorted.join('\0');
  const hash = createHash('sha256').update(joined).digest('hex').slice(0, 12);
  return `c-${hash}`;
}

export function sourceHash(atoms: Atom[], edges: ImportEdge[]): string {
  const atomParts = atoms
    .map((a) => `${a.id}:${a.filePath}:${a.metadata?.loc ?? ''}:${(a.metadata?.exportedSymbols ?? []).join(',')}`)
    .sort();

  const edgeParts = edges
    .map((e) => `${e.source}->${e.target}`)
    .sort();

  const content = [...atomParts, '---', ...edgeParts].join('\n');
  return createHash('sha256').update(content).digest('hex');
}
