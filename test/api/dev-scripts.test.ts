/**
 * Tests for npm scripts and Vite proxy configuration (Spec #12)
 *
 * AC covered:
 *  - package.json contains start:api, dev:api, dev:full scripts
 *  - Vite config includes proxy for /api → localhost:3001
 *  - concurrently is listed as a devDependency
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('npm scripts (package.json)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));

  it('should have a start:api script that runs src/api/main.ts', () => {
    expect(pkg.scripts['start:api']).toBeDefined();
    expect(pkg.scripts['start:api']).toContain('src/api/main.ts');
  });

  it('should have a dev:api script with watch mode', () => {
    expect(pkg.scripts['dev:api']).toBeDefined();
    expect(pkg.scripts['dev:api']).toContain('watch');
    expect(pkg.scripts['dev:api']).toContain('src/api/main.ts');
  });

  it('should have a dev:full script that runs both dev servers concurrently', () => {
    expect(pkg.scripts['dev:full']).toBeDefined();
    // Should reference both the vite dev server and the api dev server
    expect(pkg.scripts['dev:full']).toMatch(/dev/);
    expect(pkg.scripts['dev:full']).toMatch(/dev:api/);
  });

  it('should have concurrently as a devDependency', () => {
    expect(pkg.devDependencies['concurrently']).toBeDefined();
  });

  it('should have tsx as a devDependency', () => {
    expect(
      pkg.devDependencies['tsx'] || pkg.dependencies['tsx']
    ).toBeDefined();
  });
});

describe('Vite proxy configuration', () => {
  // We read vite.config.ts as a string and verify it contains proxy config.
  // A full import would require build tooling; string matching is sufficient
  // for a TDD contract test.
  let viteConfigSource: string;

  try {
    // Try vitest.config.ts first (may be combined), then vite.config.ts
    try {
      viteConfigSource = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf-8');
    } catch {
      viteConfigSource = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');
    }
  } catch {
    viteConfigSource = '';
  }

  it('should have a vite.config.ts or vitest.config.ts with proxy configuration', () => {
    expect(viteConfigSource).toContain('proxy');
  });

  it('should proxy /api to localhost:3001', () => {
    expect(viteConfigSource).toMatch(/['"]\/api['"]/);
    expect(viteConfigSource).toMatch(/localhost:3001/);
  });

  it('should set changeOrigin to true on the proxy', () => {
    expect(viteConfigSource).toContain('changeOrigin');
  });
});
