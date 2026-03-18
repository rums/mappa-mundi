import { resolve, relative } from 'path';
import { readdirSync, statSync } from 'fs';
import { parseFile } from './parser.js';
import { resolveImport } from './resolver.js';
import type { DependencyGraph, ModuleNode, ImportEdge, ScanOptions, ExportInfo } from './types.js';

function findTsFiles(dir: string): string[] {
  const results: string[] = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules') continue;

    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findTsFiles(fullPath));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function scan(
  projectRoot: string,
  options?: ScanOptions
): Promise<DependencyGraph> {
  const files = findTsFiles(projectRoot);

  const nodes: ModuleNode[] = [];
  const edges: ImportEdge[] = [];

  for (const filePath of files) {
    const id = relative(projectRoot, filePath);
    const parsed = await parseFile(filePath);

    // Resolve re-export sources to relative ids
    const exports: ExportInfo[] = parsed.exports.map(exp => {
      if (exp.kind === 're-export' && exp.source) {
        const resolved = resolveImport(exp.source, filePath, projectRoot, {
          tsConfigPath: options?.tsConfigPath,
        });
        if (resolved) {
          return { ...exp, source: relative(projectRoot, resolved) };
        }
      }
      return exp;
    });

    nodes.push({ id, filePath, exports });

    // Create edges from imports
    for (const imp of parsed.imports) {
      const targetPath = resolveImport(imp.specifier, filePath, projectRoot, {
        tsConfigPath: options?.tsConfigPath,
      });
      if (!targetPath) continue;

      const targetId = relative(projectRoot, targetPath);

      edges.push({
        source: id,
        target: targetId,
        imports: imp.imports,
      });
    }
  }

  return {
    root: projectRoot,
    nodes,
    edges,
  };
}
