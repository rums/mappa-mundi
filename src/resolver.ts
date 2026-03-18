import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const INDEX_FILES = EXTENSIONS.map(ext => `index${ext}`);

export function loadPathAliases(tsConfigPath: string): Record<string, string[]> {
  try {
    const content = readFileSync(tsConfigPath, 'utf-8');
    const tsConfig = JSON.parse(content);
    return tsConfig?.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

function tryResolveFile(basePath: string): string | null {
  // Try exact path first
  if (existsSync(basePath) && statSync(basePath).isFile()) {
    return basePath;
  }

  // Try adding extensions
  for (const ext of EXTENSIONS) {
    const withExt = basePath + ext;
    if (existsSync(withExt) && statSync(withExt).isFile()) {
      return withExt;
    }
  }

  // Try as directory with index files
  if (existsSync(basePath) && statSync(basePath).isDirectory()) {
    for (const indexFile of INDEX_FILES) {
      const indexPath = resolve(basePath, indexFile);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }
  }

  return null;
}

export function resolveImport(
  specifier: string,
  fromFile: string,
  projectRoot: string,
  options?: { tsConfigPath?: string }
): string | null {
  // Handle path aliases first
  if (options?.tsConfigPath && !specifier.startsWith('.') && !specifier.startsWith('/')) {
    const aliases = loadPathAliases(options.tsConfigPath);
    const tsConfigDir = dirname(options.tsConfigPath);

    // Read baseUrl from tsconfig
    let baseUrl = '.';
    try {
      const content = readFileSync(options.tsConfigPath, 'utf-8');
      const tsConfig = JSON.parse(content);
      baseUrl = tsConfig?.compilerOptions?.baseUrl ?? '.';
    } catch {
      // ignore
    }

    const baseDir = resolve(tsConfigDir, baseUrl);

    for (const [pattern, targets] of Object.entries(aliases)) {
      const prefix = pattern.replace('/*', '/');
      if (specifier.startsWith(prefix) || specifier === pattern.replace('/*', '')) {
        const rest = specifier.slice(prefix.length);
        for (const target of targets) {
          const targetPrefix = target.replace('/*', '/');
          const resolvedPath = resolve(baseDir, targetPrefix + rest);
          const result = tryResolveFile(resolvedPath);
          if (result) return result;
        }
      }
    }

    // If no alias matched, it's external
    return null;
  }

  // External/bare module specifiers
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  // Relative resolution
  const fromDir = dirname(fromFile);
  const absolutePath = resolve(fromDir, specifier);
  return tryResolveFile(absolutePath);
}
