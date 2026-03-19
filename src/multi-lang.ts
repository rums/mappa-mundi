import { readFileSync } from 'fs';
import type { ImportInfo, ExportInfo, SymbolInfo } from './types.js';

export interface LangSupport {
  extensions: string[];
  excludeDirs: string[];
  extractImports(content: string, filePath: string): string[];
  extractSymbols(content: string, filePath: string): SymbolInfo[];
}

// --- Go ---
const goSupport: LangSupport = {
  extensions: ['.go'],
  excludeDirs: ['vendor', '.git'],
  extractImports(content) {
    const imports: string[] = [];
    // Single import: import "fmt"
    for (const m of content.matchAll(/^\s*import\s+"([^"]+)"/gm)) {
      imports.push(m[1]);
    }
    // Grouped imports: import ( "fmt" \n "os" )
    for (const block of content.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
      for (const m of block[1].matchAll(/"([^"]+)"/g)) {
        imports.push(m[1]);
      }
    }
    return imports;
  },
  extractSymbols(content) {
    const symbols: SymbolInfo[] = [];
    // Functions
    for (const m of content.matchAll(/^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/gm)) {
      const exported = m[1][0] === m[1][0].toUpperCase();
      symbols.push({ name: m[1], kind: 'function', signature: m[0].trim(), exported });
    }
    // Types (struct, interface)
    for (const m of content.matchAll(/^type\s+(\w+)\s+(struct|interface)\b/gm)) {
      const exported = m[1][0] === m[1][0].toUpperCase();
      const kind = m[2] === 'interface' ? 'interface' as const : 'class' as const;
      symbols.push({ name: m[1], kind, signature: `type ${m[1]} ${m[2]}`, exported });
    }
    return symbols;
  },
};

// --- Rust ---
const rustSupport: LangSupport = {
  extensions: ['.rs'],
  excludeDirs: ['target', '.git'],
  extractImports(content) {
    const imports: string[] = [];
    for (const m of content.matchAll(/^\s*use\s+((?:crate|super|self)(?:::\w+)+)/gm)) {
      imports.push(m[1]);
    }
    // mod declarations
    for (const m of content.matchAll(/^\s*mod\s+(\w+)\s*;/gm)) {
      imports.push(m[1]);
    }
    return imports;
  },
  extractSymbols(content) {
    const symbols: SymbolInfo[] = [];
    for (const m of content.matchAll(/^\s*(pub\s+)?fn\s+(\w+)/gm)) {
      symbols.push({ name: m[2], kind: 'function', signature: m[0].trim(), exported: !!m[1] });
    }
    for (const m of content.matchAll(/^\s*(pub\s+)?struct\s+(\w+)/gm)) {
      symbols.push({ name: m[2], kind: 'class', signature: m[0].trim(), exported: !!m[1] });
    }
    for (const m of content.matchAll(/^\s*(pub\s+)?trait\s+(\w+)/gm)) {
      symbols.push({ name: m[2], kind: 'interface', signature: m[0].trim(), exported: !!m[1] });
    }
    for (const m of content.matchAll(/^\s*(pub\s+)?enum\s+(\w+)/gm)) {
      symbols.push({ name: m[2], kind: 'enum', signature: m[0].trim(), exported: !!m[1] });
    }
    return symbols;
  },
};

// --- Python ---
const pythonSupport: LangSupport = {
  extensions: ['.py'],
  excludeDirs: ['__pycache__', '.venv', 'venv', '.git', 'node_modules'],
  extractImports(content) {
    const imports: string[] = [];
    // import foo / import foo.bar
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) {
      imports.push(m[1]);
    }
    // from foo import bar / from foo.bar import baz
    for (const m of content.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)) {
      imports.push(m[1]);
    }
    return imports;
  },
  extractSymbols(content) {
    const symbols: SymbolInfo[] = [];
    for (const m of content.matchAll(/^def\s+(\w+)\s*\(/gm)) {
      symbols.push({ name: m[1], kind: 'function', signature: m[0].trim(), exported: !m[1].startsWith('_') });
    }
    for (const m of content.matchAll(/^class\s+(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'class', signature: m[0].trim(), exported: !m[1].startsWith('_') });
    }
    return symbols;
  },
};

// --- C/C++ ---
const cppSupport: LangSupport = {
  extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
  excludeDirs: ['build', '.git', 'node_modules', 'cmake-build-debug', 'cmake-build-release'],
  extractImports(content) {
    const imports: string[] = [];
    // #include "foo.h" (local includes only, not <system>)
    for (const m of content.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
      imports.push(m[1]);
    }
    return imports;
  },
  extractSymbols(content) {
    const symbols: SymbolInfo[] = [];
    // Functions (simplified: return_type name(...))
    for (const m of content.matchAll(/^(?:[\w:*&<> ]+?)\s+(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:\{|;)/gm)) {
      const name = m[1];
      if (['if', 'while', 'for', 'switch', 'return', 'delete', 'new'].includes(name)) continue;
      symbols.push({ name, kind: 'function', signature: m[0].slice(0, 80).trim(), exported: true });
    }
    // Classes/structs
    for (const m of content.matchAll(/^(?:class|struct)\s+(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'class', signature: m[0].trim(), exported: true });
    }
    // Enums
    for (const m of content.matchAll(/^enum\s+(?:class\s+)?(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'enum', signature: m[0].trim(), exported: true });
    }
    return symbols;
  },
};

// --- TypeScript/JavaScript (lightweight, no AST) ---
const tsLightSupport: LangSupport = {
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  excludeDirs: ['node_modules', '.git', 'dist', 'build'],
  extractImports(content) {
    const imports: string[] = [];
    for (const m of content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)) {
      imports.push(m[1]);
    }
    return imports;
  },
  extractSymbols(content) {
    const symbols: SymbolInfo[] = [];
    for (const m of content.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'function', signature: m[0].trim(), exported: true });
    }
    for (const m of content.matchAll(/^export\s+(?:default\s+)?class\s+(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'class', signature: m[0].trim(), exported: true });
    }
    for (const m of content.matchAll(/^export\s+(?:type|interface)\s+(\w+)/gm)) {
      symbols.push({ name: m[1], kind: 'interface', signature: m[0].trim(), exported: true });
    }
    return symbols;
  },
};

export const LANG_SUPPORT: LangSupport[] = [
  goSupport,
  rustSupport,
  pythonSupport,
  cppSupport,
  tsLightSupport,
];

/** Get the language support for a file extension, or null. */
export function getLangForExt(ext: string): LangSupport | null {
  return LANG_SUPPORT.find(l => l.extensions.includes(ext)) ?? null;
}

/** Get all source file extensions we support. */
export function allSourceExtensions(): string[] {
  return LANG_SUPPORT.flatMap(l => l.extensions);
}

/** Get all directories to exclude. */
export function allExcludeDirs(): Set<string> {
  const dirs = new Set<string>();
  for (const l of LANG_SUPPORT) {
    for (const d of l.excludeDirs) dirs.add(d);
  }
  return dirs;
}
