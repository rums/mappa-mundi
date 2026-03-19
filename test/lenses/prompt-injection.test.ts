import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/interpret/prompt.js';
import type { DependencyGraph } from '../../src/types.js';
import type { DirectoryNode } from '../../src/directory-tree.js';

const minimalGraph: DependencyGraph = {
  root: '/project',
  nodes: [
    { id: 'src/foo.ts', filePath: '/project/src/foo.ts', exports: [], symbols: [] },
  ],
  edges: [],
};

const minimalDirTree: DirectoryNode = {
  name: 'project',
  path: '/project',
  files: [],
  children: [
    {
      name: 'src',
      path: 'src',
      files: ['src/foo.ts'],
      children: [],
      isBoundary: false,
      metrics: { fileCount: 1, totalLoc: 100, subtreeFileCount: 1, subtreeLoc: 100 },
    },
  ],
  isBoundary: false,
  metrics: { fileCount: 0, totalLoc: 0, subtreeFileCount: 1, subtreeLoc: 100 },
};

describe('buildPrompt with compound lens', () => {
  it('includes lens section when compoundLensPrompt is provided', () => {
    const prompt = buildPrompt(minimalGraph, minimalDirTree, {
      compoundLensPrompt: 'Group by architectural layer',
    });
    expect(prompt).toContain('## Grouping Lens');
    expect(prompt).toContain('Group by architectural layer');
  });

  it('does not include lens section when no lens prompt', () => {
    const prompt = buildPrompt(minimalGraph, minimalDirTree);
    expect(prompt).not.toContain('## Grouping Lens');
  });

  it('lens section appears before directory structure', () => {
    const prompt = buildPrompt(minimalGraph, minimalDirTree, {
      compoundLensPrompt: 'Group by security domain',
    });
    const lensIdx = prompt.indexOf('## Grouping Lens');
    const dirIdx = prompt.indexOf('## Directory Structure');
    expect(lensIdx).toBeLessThan(dirIdx);
  });

  it('lens section survives truncation', () => {
    const prompt = buildPrompt(minimalGraph, minimalDirTree, {
      compoundLensPrompt: 'Group by team ownership',
      maxPromptTokens: 100, // Very small budget
    });
    expect(prompt).toContain('## Grouping Lens');
    expect(prompt).toContain('Group by team ownership');
  });
});
