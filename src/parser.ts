import { parseSync } from '@swc/core';
import { readFileSync } from 'fs';
import type { ImportInfo, ExportInfo } from './types.js';

export interface ParseResult {
  imports: Array<{ specifier: string; imports: ImportInfo[] }>;
  exports: ExportInfo[];
}

export async function parseFile(filePath: string): Promise<ParseResult> {
  const result: ParseResult = { imports: [], exports: [] };

  let code: string;
  try {
    code = readFileSync(filePath, 'utf-8');
  } catch {
    return result;
  }

  if (!code.trim()) {
    return result;
  }

  let ast: any;
  try {
    ast = parseSync(code, {
      syntax: 'typescript',
      tsx: filePath.endsWith('.tsx'),
    });
  } catch {
    return result;
  }

  const importMap = new Map<string, ImportInfo[]>();

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const specifier = node.source.value as string;

      // Skip external/bare specifiers (but allow path aliases starting with @)
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('@')) {
        continue;
      }

      if (!importMap.has(specifier)) {
        importMap.set(specifier, []);
      }
      const imports = importMap.get(specifier)!;

      const isTypeOnly = node.typeOnly === true;

      if (!node.specifiers || node.specifiers.length === 0) {
        // Side-effect import: import './foo'
        imports.push({ name: '*', kind: 'side-effect' });
      } else {
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportDefaultSpecifier') {
            imports.push({ name: 'default', kind: 'default' });
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            imports.push({ name: '*', kind: 'namespace' });
          } else if (spec.type === 'ImportSpecifier') {
            if (isTypeOnly) {
              const info: ImportInfo = {
                name: spec.local.value ?? spec.local,
                kind: 'type-only',
              };
              // Check for imported name vs local name
              if (spec.imported && spec.imported.value !== spec.local.value) {
                info.name = spec.imported.value;
                info.alias = spec.local.value;
              }
              imports.push(info);
            } else {
              const importedName = spec.imported
                ? (spec.imported.value ?? spec.imported)
                : (spec.local.value ?? spec.local);
              const localName = spec.local.value ?? spec.local;

              const info: ImportInfo = {
                name: importedName,
                kind: 'named',
              };
              if (importedName !== localName) {
                info.alias = localName;
              }
              imports.push(info);
            }
          }
        }
      }
    }

    // Handle exports
    if (node.type === 'ExportDeclaration') {
      const decl = node.declaration;
      if (decl) {
        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            if (declarator.id && declarator.id.type === 'Identifier') {
              result.exports.push({
                name: declarator.id.value,
                kind: 'named',
              });
            }
          }
        } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          if (decl.identifier) {
            result.exports.push({
              name: decl.identifier.value,
              kind: 'named',
            });
          }
        } else if (decl.type === 'TsInterfaceDeclaration') {
          result.exports.push({
            name: decl.id.value,
            kind: 'named',
          });
        } else if (decl.type === 'TsTypeAliasDeclaration') {
          result.exports.push({
            name: decl.id.value,
            kind: 'named',
          });
        }
      }
    }

    if (node.type === 'ExportDefaultDeclaration' || node.type === 'ExportDefaultExpression') {
      result.exports.push({
        name: 'default',
        kind: 'default',
      });
    }

    if (node.type === 'ExportNamedDeclaration') {
      const source = node.source?.value;

      // Named re-exports: export { x } from './y'
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            const origName = spec.orig?.value ?? spec.orig;
            const exportedName = spec.exported
              ? (spec.exported.value ?? spec.exported)
              : origName;

            if (source) {
              // Re-export
              const info: ExportInfo = {
                name: exportedName,
                kind: 're-export',
                source,
              };
              result.exports.push(info);

              // Also track as an import (for edge creation)
              if (!specifier_starts_relative(source)) continue;
              if (!importMap.has(source)) {
                importMap.set(source, []);
              }
              const importInfo: ImportInfo = {
                name: origName,
                kind: 'named',
              };
              if (origName !== exportedName) {
                importInfo.alias = exportedName;
              }
              importMap.get(source)!.push(importInfo);
            } else {
              // Plain named export: export { x }
              result.exports.push({
                name: exportedName,
                kind: 'named',
              });
            }
          } else if (spec.type === 'ExportNamespaceSpecifier') {
            if (source) {
              const exportedName = spec.name?.value ?? spec.name;
              result.exports.push({
                name: exportedName,
                kind: 're-export',
                source,
              });
              if (specifier_starts_relative(source)) {
                if (!importMap.has(source)) {
                  importMap.set(source, []);
                }
                importMap.get(source)!.push({
                  name: '*',
                  kind: 'namespace',
                });
              }
            }
          }
        }
      }

      // Named declaration export: export const x = ...
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            if (declarator.id && declarator.id.type === 'Identifier') {
              result.exports.push({
                name: declarator.id.value,
                kind: 'named',
              });
            }
          }
        } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          if (decl.identifier) {
            result.exports.push({
              name: decl.identifier.value,
              kind: 'named',
            });
          }
        }
      }
    }
  }

  // Convert import map to array
  for (const [specifier, imports] of importMap) {
    result.imports.push({ specifier, imports });
  }

  return result;
}

function specifier_starts_relative(s: string): boolean {
  return s.startsWith('.') || s.startsWith('/');
}
