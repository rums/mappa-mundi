import { resolve, relative, extname } from 'path';
import { readdirSync, statSync, readFileSync } from 'fs';
import { parseFile } from './parser.js';
import { resolveImport } from './resolver.js';
import { extractSymbols } from './symbol-extractor.js';
import { getLangForExt, allSourceExtensions, allExcludeDirs } from './multi-lang.js';
import type { DependencyGraph, ModuleNode, ImportEdge, ScanOptions, ExportInfo, ImportInfo } from './types.js';

const SOURCE_EXTS = new Set(allSourceExtensions());
const EXCLUDE_DIRS = allExcludeDirs();

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const fullPath = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else {
      const ext = extname(entry);
      if (SOURCE_EXTS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/** Check if a project has TypeScript files (use full AST parser). */
function hasTypeScript(files: string[]): boolean {
  return files.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
}

export async function scan(
  projectRoot: string,
  options?: ScanOptions
): Promise<DependencyGraph> {
  const files = findSourceFiles(projectRoot);
  const useFullTsParser = hasTypeScript(files);

  const nodes: ModuleNode[] = [];
  const edges: ImportEdge[] = [];

  // Build a set of all module IDs for resolving internal imports
  const allIds = new Set(files.map(f => relative(projectRoot, f)));

  for (const filePath of files) {
    const id = relative(projectRoot, filePath);
    const ext = extname(filePath);
    const isTs = ext === '.ts' || ext === '.tsx';

    let exports: ExportInfo[] = [];
    let symbols: import('./types.js').SymbolInfo[] = [];
    let importSpecifiers: string[] = [];

    if (isTs && useFullTsParser) {
      // Full AST parsing for TypeScript
      try {
        const parsed = await parseFile(filePath);
        exports = parsed.exports.map(exp => {
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

        symbols = await extractSymbols(filePath);

        for (const imp of parsed.imports) {
          const targetPath = resolveImport(imp.specifier, filePath, projectRoot, {
            tsConfigPath: options?.tsConfigPath,
          });
          if (!targetPath) continue;
          const targetId = relative(projectRoot, targetPath);
          edges.push({ source: id, target: targetId, imports: imp.imports });
        }
      } catch {
        // AST parse failed — fall through to regex
        const lang = getLangForExt(ext);
        if (lang) {
          const content = readFileSync(filePath, 'utf-8');
          symbols = lang.extractSymbols(content, filePath);
          importSpecifiers = lang.extractImports(content, filePath);
        }
      }
    } else {
      // Regex-based extraction for other languages
      const lang = getLangForExt(ext);
      if (lang) {
        const content = readFileSync(filePath, 'utf-8');
        symbols = lang.extractSymbols(content, filePath);
        importSpecifiers = lang.extractImports(content, filePath);
      }
    }

    nodes.push({ id, filePath, exports, symbols });

    // Resolve regex-extracted imports to edges
    if (importSpecifiers.length > 0) {
      for (const spec of importSpecifiers) {
        // Try to find a matching file in the project
        const targetId = resolveImportSpec(spec, id, allIds, projectRoot);
        if (targetId) {
          const imp: ImportInfo = { name: spec.split('/').pop() || spec, kind: 'named' };
          edges.push({ source: id, target: targetId, imports: [imp] });
        }
      }
    }
  }

  return { root: projectRoot, nodes, edges };
}

/**
 * Resolve an import specifier to a module ID in the project.
 * Tries several strategies: relative path, package path matching, include path.
 */
function resolveImportSpec(
  spec: string,
  fromId: string,
  allIds: Set<string>,
  projectRoot: string,
): string | null {
  // Direct match (e.g., C++ #include "foo.h" relative to file)
  const fromDir = fromId.split('/').slice(0, -1).join('/');
  const relative1 = fromDir ? `${fromDir}/${spec}` : spec;
  if (allIds.has(relative1)) return relative1;

  // Match by filename anywhere in the project
  const specBasename = spec.split('/').pop() || spec;
  for (const id of allIds) {
    const idBasename = id.split('/').pop() || id;
    if (idBasename === specBasename && id !== fromId) return id;
  }

  // Go: match by last path segment(s) to a directory
  // e.g., "myproject/pkg/foo" -> find files under "pkg/foo/"
  const specParts = spec.split('/');
  if (specParts.length >= 2) {
    const suffix = specParts.slice(-2).join('/');
    for (const id of allIds) {
      if (id.includes(suffix) && id !== fromId) return id;
    }
  }

  // Python: dotted path (foo.bar.baz -> foo/bar/baz.py or foo/bar/baz/__init__.py)
  if (spec.includes('.') && !spec.includes('/')) {
    const asPath = spec.replace(/\./g, '/');
    for (const candidate of [`${asPath}.py`, `${asPath}/__init__.py`]) {
      if (allIds.has(candidate)) return candidate;
    }
  }

  // Rust: crate::foo::bar -> src/foo/bar.rs or src/foo.rs
  if (spec.startsWith('crate::')) {
    const rustPath = spec.replace('crate::', '').replace(/::/g, '/');
    for (const candidate of [`src/${rustPath}.rs`, `src/${rustPath}/mod.rs`]) {
      if (allIds.has(candidate)) return candidate;
    }
  }

  return null;
}
