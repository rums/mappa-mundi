import type { DependencyGraph, ModuleNode } from '../types';
import type { DirectoryNode } from '../directory-tree';

interface PromptOptions {
  maxPromptTokens?: number;
}

export function buildPrompt(
  graph: DependencyGraph,
  dirTree: DirectoryNode,
  options?: PromptOptions,
): string {
  // Sort everything deterministically
  const sortedChildren = [...dirTree.children].sort((a, b) => a.path.localeCompare(b.path));
  const sortedNodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...graph.edges].sort((a, b) => {
    const cmp = a.source.localeCompare(b.source);
    if (cmp !== 0) return cmp;
    return a.target.localeCompare(b.target);
  });

  // Build module lookup by directory
  const modulesByDir = new Map<string, ModuleNode[]>();
  for (const node of sortedNodes) {
    for (const child of sortedChildren) {
      const prefix = child.path.endsWith('/') ? child.path : child.path + '/';
      if (node.id.startsWith(prefix)) {
        if (!modulesByDir.has(child.path)) modulesByDir.set(child.path, []);
        modulesByDir.get(child.path)!.push(node);
        break;
      }
    }
  }

  // Identify cross-directory edges
  const crossDirEdges: Array<{ source: string; target: string; sourceDir: string; targetDir: string }> = [];
  for (const edge of sortedEdges) {
    const sourceDir = findDir(edge.source, sortedChildren);
    const targetDir = findDir(edge.target, sortedChildren);
    if (sourceDir && targetDir && sourceDir !== targetDir) {
      crossDirEdges.push({
        source: edge.source,
        target: edge.target,
        sourceDir: getDirName(sourceDir, sortedChildren),
        targetDir: getDirName(targetDir, sortedChildren),
      });
    }
  }

  const maxTokens = options?.maxPromptTokens;

  // Build sections
  const dirSection = buildDirSection(sortedChildren, dirTree);
  const symbolSection = buildSymbolSection(sortedChildren, modulesByDir);
  const edgeSection = buildEdgeSection(crossDirEdges);
  const boundarySection = buildBoundarySection(sortedChildren);

  if (!maxTokens) {
    return [dirSection, symbolSection, edgeSection, boundarySection]
      .filter(Boolean)
      .join('\n\n');
  }

  // Truncation strategy
  const maxChars = maxTokens * 4;

  // Try full prompt first
  let prompt = [dirSection, symbolSection, edgeSection, boundarySection]
    .filter(Boolean)
    .join('\n\n');

  if (prompt.length <= maxChars) return prompt;

  // Remove symbol details first
  prompt = [dirSection, edgeSection, boundarySection]
    .filter(Boolean)
    .join('\n\n');

  if (prompt.length <= maxChars) return prompt;

  // Remove internal edges (keep only unique dir-to-dir summaries)
  const uniqueEdges = new Map<string, string>();
  for (const e of crossDirEdges) {
    const key = `${e.sourceDir} → ${e.targetDir}`;
    uniqueEdges.set(key, key);
  }
  const compactEdgeSection = uniqueEdges.size > 0
    ? '## Cross-Directory Dependencies\n' + [...uniqueEdges.values()].join('\n')
    : '';

  prompt = [dirSection, compactEdgeSection, boundarySection]
    .filter(Boolean)
    .join('\n\n');

  if (prompt.length <= maxChars) return prompt;

  // Last resort: just directory names + boundaries
  prompt = [dirSection, boundarySection]
    .filter(Boolean)
    .join('\n\n');

  return prompt;
}

function findDir(moduleId: string, children: DirectoryNode[]): string | null {
  for (const child of children) {
    const prefix = child.path.endsWith('/') ? child.path : child.path + '/';
    if (moduleId.startsWith(prefix)) return child.path;
  }
  return null;
}

function getDirName(dirPath: string, children: DirectoryNode[]): string {
  for (const child of children) {
    if (child.path === dirPath) return child.name;
  }
  return dirPath;
}

function buildDirSection(children: DirectoryNode[], root: DirectoryNode): string {
  const lines = ['## Directory Structure', `Root: ${root.name}`];
  for (const child of children) {
    lines.push(`- ${child.name}/ (${child.metrics.subtreeFileCount} files, ${child.metrics.subtreeLoc} LOC)`);
  }
  return lines.join('\n');
}

function buildSymbolSection(children: DirectoryNode[], modulesByDir: Map<string, ModuleNode[]>): string {
  const lines = ['## Exported Symbols'];
  for (const child of children) {
    const modules = modulesByDir.get(child.path) || [];
    const symbols = modules.flatMap((m) =>
      m.symbols
        .filter((s) => s.exported)
        .map((s) => `  - ${s.name}: ${s.kind} ${s.signature}`),
    );
    if (symbols.length > 0) {
      lines.push(`### ${child.name}/`);
      lines.push(...symbols);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function buildEdgeSection(
  crossDirEdges: Array<{ source: string; target: string; sourceDir: string; targetDir: string }>,
): string {
  if (crossDirEdges.length === 0) return '';
  const lines = ['## Cross-Directory Dependencies'];
  for (const e of crossDirEdges) {
    lines.push(`- ${e.sourceDir} → ${e.targetDir} (${e.source} → ${e.target})`);
  }
  return lines.join('\n');
}

function buildBoundarySection(children: DirectoryNode[]): string {
  const boundaries = children.filter((c) => c.isBoundary);
  if (boundaries.length === 0) return '';
  const lines = ['## Boundary Flags'];
  for (const b of boundaries) {
    lines.push(`- ${b.name}/ is a boundary module`);
  }
  return lines.join('\n');
}
