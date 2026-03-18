import { readdir, readFile } from 'node:fs/promises';
import { join, relative, basename, extname } from 'node:path';
import type { DependencyGraph } from './types';
import { detectBoundary, computeEdgeCounts } from './boundary-detector';

export interface DirectoryTreeOptions {
  excludePatterns?: string[];
  boundaryThreshold?: number;
}

export interface DirectoryNode {
  name: string;
  path: string;
  files: string[];
  children: DirectoryNode[];
  isBoundary: boolean;
  metrics: {
    fileCount: number;
    totalLoc: number;
    fileCountByExtension: Record<string, number>;
    exportedSymbolCount: number;
    subtreeFileCount: number;
    subtreeLoc: number;
    subtreeExportedSymbolCount: number;
    inboundEdges: number;
    outboundEdges: number;
  };
}

const LOC_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx']);
const ALWAYS_EXCLUDED = new Set(['.git', 'node_modules']);

async function parseGitignore(projectRoot: string): Promise<string[]> {
  try {
    const content = await readFile(join(projectRoot, '.gitignore'), 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.replace(/\/$/, '')); // strip trailing slash
  } catch {
    return [];
  }
}

function isExcluded(name: string, excludedNames: Set<string>): boolean {
  if (ALWAYS_EXCLUDED.has(name)) return true;
  if (excludedNames.has(name)) return true;
  return false;
}

async function countNonEmptyLines(filePath: string): Promise<number> {
  const content = await readFile(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim().length > 0).length;
}

async function walkDir(
  absDir: string,
  projectRoot: string,
  excludedNames: Set<string>,
  graph: DependencyGraph,
  threshold: number,
): Promise<DirectoryNode | null> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const relDir = relative(projectRoot, absDir) || '.';

  const files: string[] = [];
  const childNodes: DirectoryNode[] = [];

  const fileCountByExtension: Record<string, number> = {};
  let totalLoc = 0;

  // Process entries
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isExcluded(entry.name, excludedNames)) continue;
      const childNode = await walkDir(
        join(absDir, entry.name),
        projectRoot,
        excludedNames,
        graph,
        threshold,
      );
      if (childNode) childNodes.push(childNode);
    } else if (entry.isFile()) {
      const relPath = relDir === '.' ? entry.name : `${relDir}/${entry.name}`;
      files.push(relPath);

      const ext = extname(entry.name);
      fileCountByExtension[ext] = (fileCountByExtension[ext] || 0) + 1;

      if (LOC_EXTENSIONS.has(ext)) {
        totalLoc += await countNonEmptyLines(join(absDir, entry.name));
      }
    }
  }

  // Prune empty directories
  if (files.length === 0 && childNodes.length === 0) {
    return null;
  }

  // Count exported symbols for files directly in this directory
  const dirPrefix = relDir === '.' ? null : relDir + '/';
  let exportedSymbolCount = 0;
  for (const node of graph.nodes) {
    // node.id is relative path like "src/auth/login.ts"
    const nodeDir = dirPrefix
      ? node.id.startsWith(dirPrefix) && !node.id.slice(dirPrefix.length).includes('/')
      : !node.id.includes('/');
    if (nodeDir) {
      exportedSymbolCount += node.symbols.filter(s => s.exported).length;
    }
  }

  // Edge counts
  const edgeCounts = relDir === '.'
    ? computeEdgeCounts('', graph.edges.map(e => ({ ...e, source: '/' + e.source, target: '/' + e.target })))
    : computeEdgeCounts(relDir, graph.edges);

  const crossBoundary = edgeCounts.inbound + edgeCounts.outbound;
  const isBoundary = detectBoundary(crossBoundary, edgeCounts.internal, threshold);

  // Subtree aggregation
  const subtreeFileCount = files.length + childNodes.reduce((sum, c) => sum + c.metrics.subtreeFileCount, 0);
  const subtreeLoc = totalLoc + childNodes.reduce((sum, c) => sum + c.metrics.subtreeLoc, 0);
  const subtreeExportedSymbolCount = exportedSymbolCount + childNodes.reduce((sum, c) => sum + c.metrics.subtreeExportedSymbolCount, 0);

  // Sort children by name for consistency
  childNodes.sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: relDir === '.' ? basename(projectRoot) : basename(relDir),
    path: relDir,
    files,
    children: childNodes,
    isBoundary,
    metrics: {
      fileCount: files.length,
      totalLoc,
      fileCountByExtension,
      exportedSymbolCount,
      subtreeFileCount,
      subtreeLoc,
      subtreeExportedSymbolCount,
      inboundEdges: edgeCounts.inbound,
      outboundEdges: edgeCounts.outbound,
    },
  };
}

export async function buildDirectoryTree(
  projectRoot: string,
  graph: DependencyGraph,
  options?: DirectoryTreeOptions,
): Promise<DirectoryNode> {
  const threshold = options?.boundaryThreshold ?? 0.7;

  // Parse .gitignore
  const gitignorePatterns = await parseGitignore(projectRoot);
  const customPatterns = (options?.excludePatterns ?? []).map(p => p.replace(/\/$/, ''));
  const excludedNames = new Set([...gitignorePatterns, ...customPatterns]);

  const tree = await walkDir(projectRoot, projectRoot, excludedNames, graph, threshold);

  // If root is null (empty project), return empty root node
  if (!tree) {
    return {
      name: basename(projectRoot),
      path: '.',
      files: [],
      children: [],
      isBoundary: false,
      metrics: {
        fileCount: 0,
        totalLoc: 0,
        fileCountByExtension: {},
        exportedSymbolCount: 0,
        subtreeFileCount: 0,
        subtreeLoc: 0,
        subtreeExportedSymbolCount: 0,
        inboundEdges: 0,
        outboundEdges: 0,
      },
    };
  }

  return tree;
}
