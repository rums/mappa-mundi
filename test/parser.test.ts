import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { parseFile } from '../src/parser';
import type { ImportInfo, ExportInfo } from '../src/types';

const fixture = (name: string, file: string) =>
  resolve(__dirname, 'fixtures', name, file);

describe('Parser: Import Extraction', () => {
  it('should extract named imports', async () => {
    const result = await parseFile(fixture('basic-chain', 'a.ts'));

    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: './b',
          imports: expect.arrayContaining([
            expect.objectContaining({ name: 'greet', kind: 'named' }),
          ]),
        }),
      ])
    );
  });

  it('should extract default imports', async () => {
    const result = await parseFile(fixture('import-kinds', 'source.ts'));

    const targetImports = result.imports.filter(i => i.specifier === './target');
    const allImports = targetImports.flatMap(i => i.imports);
    expect(allImports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'default' }),
      ])
    );
  });

  it('should extract namespace imports', async () => {
    const result = await parseFile(fixture('import-kinds', 'source.ts'));

    const targetImports = result.imports.filter(i => i.specifier === './target');
    const allImports = targetImports.flatMap(i => i.imports);
    expect(allImports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'namespace' }),
      ])
    );
  });

  it('should extract aliased named imports with name and alias fields', async () => {
    const result = await parseFile(fixture('import-kinds', 'aliased.ts'));

    const targetImports = result.imports.filter(i => i.specifier === './target');
    const allImports = targetImports.flatMap(i => i.imports);
    expect(allImports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'namedExport',
          alias: 'renamed',
          kind: 'named',
        }),
      ])
    );
  });

  it('should extract type-only imports', async () => {
    const result = await parseFile(fixture('type-only', 'consumer.ts'));

    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: './types',
          imports: expect.arrayContaining([
            expect.objectContaining({ name: 'Foo', kind: 'type-only' }),
          ]),
        }),
      ])
    );
  });

  it('should extract side-effect imports', async () => {
    const result = await parseFile(fixture('side-effect', 'consumer.ts'));

    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: './polyfill',
          imports: expect.arrayContaining([
            expect.objectContaining({ kind: 'side-effect' }),
          ]),
        }),
      ])
    );
  });

  it('should collapse multiple imports from the same module into one entry', async () => {
    const result = await parseFile(fixture('import-kinds', 'source.ts'));

    // All 3 imports (default, named, namespace) from './target' should be in one group
    const targetImports = result.imports.filter(i => i.specifier === './target');
    expect(targetImports).toHaveLength(1);
    expect(targetImports[0].imports).toHaveLength(3);
  });

  it('should ignore external/bare module specifiers', async () => {
    // No imports from non-relative specifiers should be tracked
    const result = await parseFile(fixture('basic-chain', 'a.ts'));

    for (const imp of result.imports) {
      // All specifiers should be relative paths
      expect(imp.specifier).toMatch(/^\.\.?[/\\]/);
    }
  });
});

describe('Parser: Export Extraction', () => {
  it('should extract named exports', async () => {
    const result = await parseFile(fixture('basic-chain', 'c.ts'));

    expect(result.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', kind: 'named' }),
      ])
    );
  });

  it('should extract default exports', async () => {
    const result = await parseFile(fixture('import-kinds', 'target.ts'));

    expect(result.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'default' }),
      ])
    );
  });

  it('should extract re-exports with source', async () => {
    const result = await parseFile(fixture('barrel', 'index.ts'));

    expect(result.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'foo', kind: 're-export' }),
        expect.objectContaining({ name: 'bar', kind: 're-export' }),
      ])
    );

    // Re-exports should reference the source specifier
    const reExports = result.exports.filter(e => e.kind === 're-export');
    for (const re of reExports) {
      expect(re.source).toBeDefined();
    }
  });

  it('should extract renamed re-exports', async () => {
    const result = await parseFile(fixture('barrel', 'index.ts'));

    expect(result.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Baz',
          kind: 're-export',
        }),
      ])
    );
  });
});

describe('Parser: Error Handling', () => {
  it('should return empty imports and exports for syntax error files', async () => {
    const result = await parseFile(fixture('syntax-error', 'bad.ts'));

    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });

  it('should return empty results for empty files', async () => {
    const result = await parseFile(fixture('isolated', 'empty.ts'));

    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });
});
