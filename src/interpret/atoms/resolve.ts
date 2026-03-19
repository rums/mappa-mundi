import type { DependencyGraph } from '../../types.js';

export interface Atom {
  id: string;
  label: string;
  filePath: string;
  metadata?: {
    loc?: number;
    exportedSymbols?: string[];
  };
}

export function resolveAtoms(graph: DependencyGraph): Atom[] {
  return graph.nodes.map((mod) => {
    const exportedSymbols = mod.symbols
      .filter((s) => s.exported)
      .map((s) => s.name);

    return {
      id: mod.id,
      filePath: mod.filePath,
      label: mod.id.split('/').pop() || mod.id,
      metadata: {
        loc: undefined,
        exportedSymbols,
      },
    };
  });
}
