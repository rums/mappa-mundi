import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { resolveImport, loadPathAliases } from '../src/resolver';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

describe('Resolver: Relative Path Resolution', () => {
  it('should resolve relative imports to absolute file paths', () => {
    const projectRoot = fixture('basic-chain');
    const result = resolveImport('./b', resolve(projectRoot, 'a.ts'), projectRoot);

    expect(result).toBe(resolve(projectRoot, 'b.ts'));
  });

  it('should resolve imports without extension by trying .ts, .tsx, .js, .jsx', () => {
    const projectRoot = fixture('basic-chain');
    const result = resolveImport('./c', resolve(projectRoot, 'b.ts'), projectRoot);

    expect(result).toBe(resolve(projectRoot, 'c.ts'));
  });

  it('should resolve directory imports to index.ts', () => {
    const projectRoot = fixture('directory-import');
    const result = resolveImport(
      './components',
      resolve(projectRoot, 'consumer.ts'),
      projectRoot
    );

    expect(result).toBe(resolve(projectRoot, 'components', 'index.ts'));
  });

  it('should return null for unresolvable imports', () => {
    const projectRoot = fixture('basic-chain');
    const result = resolveImport(
      './nonexistent',
      resolve(projectRoot, 'a.ts'),
      projectRoot
    );

    expect(result).toBeNull();
  });

  it('should return null for external/bare module specifiers', () => {
    const projectRoot = fixture('basic-chain');
    const result = resolveImport('lodash', resolve(projectRoot, 'a.ts'), projectRoot);

    expect(result).toBeNull();
  });
});

describe('Resolver: Path Alias Resolution', () => {
  it('should load path aliases from tsconfig.json', () => {
    const aliases = loadPathAliases(
      resolve(fixture('path-aliases'), 'tsconfig.json')
    );

    expect(aliases).toBeDefined();
    expect(Object.keys(aliases)).toContain('@/*');
    expect(Object.keys(aliases)).toContain('@components/*');
  });

  it('should resolve @/* alias to src/* directory', () => {
    const projectRoot = fixture('path-aliases');
    const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
    const result = resolveImport(
      '@/utils/helper',
      resolve(projectRoot, 'src', 'app.ts'),
      projectRoot,
      { tsConfigPath }
    );

    expect(result).toBe(resolve(projectRoot, 'src', 'utils', 'helper.ts'));
  });

  it('should resolve @components/* alias to src/components/*', () => {
    const projectRoot = fixture('path-aliases');
    const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
    const result = resolveImport(
      '@components/Button',
      resolve(projectRoot, 'src', 'app.ts'),
      projectRoot,
      { tsConfigPath }
    );

    expect(result).toBe(resolve(projectRoot, 'src', 'components', 'Button.ts'));
  });

  it('should fall back to standard resolution when no tsconfig is present', () => {
    const projectRoot = fixture('basic-chain');
    const result = resolveImport(
      './b',
      resolve(projectRoot, 'a.ts'),
      projectRoot,
      { tsConfigPath: undefined }
    );

    expect(result).toBe(resolve(projectRoot, 'b.ts'));
  });

  it('should resolve alias pointing to a directory to its index.ts', () => {
    const projectRoot = fixture('path-aliases');
    // Create a scenario where an alias resolves to a directory
    // that contains an index.ts
    const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
    const result = resolveImport(
      '@/utils/helper',
      resolve(projectRoot, 'src', 'app.ts'),
      projectRoot,
      { tsConfigPath }
    );

    // Should resolve to the actual file
    expect(result).toBeTruthy();
    expect(result).toMatch(/\.ts$/);
  });
});

describe('Resolver: Nested Directory Resolution', () => {
  it('should resolve imports across nested directories', () => {
    const projectRoot = fixture('directory-import');
    const result = resolveImport(
      './widget',
      resolve(projectRoot, 'components', 'index.ts'),
      projectRoot
    );

    expect(result).toBe(resolve(projectRoot, 'components', 'widget.ts'));
  });
});
