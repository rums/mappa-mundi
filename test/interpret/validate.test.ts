import { describe, it, expect } from 'vitest';
import { validateAndFix } from '../../src/interpret/validate';

// ─── Types for raw LLM response ─────────────────────────────────────────────

interface RawRegion {
  name: string;
  summary: string;
  modules: string[];
}

// ─── Validation & Post-Processing Tests ─────────────────────────────────────

describe('Validate: schema validation', () => {
  it('should accept a well-formed response with valid regions', () => {
    const raw = {
      regions: [
        { name: 'Auth', summary: 'Authentication', modules: ['src/auth/login.ts'] },
        { name: 'API', summary: 'API layer', modules: ['src/api/handler.ts'] },
      ],
    };
    const allModuleIds = ['src/auth/login.ts', 'src/api/handler.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(true);
    expect(result.regions.length).toBe(2);
  });

  it('should reject a response missing the regions array', () => {
    const raw = { unrelated: 'data' };
    const allModuleIds = ['src/auth/login.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(false);
  });

  it('should reject a response where regions is not an array', () => {
    const raw = { regions: 'not an array' };
    const allModuleIds = ['src/auth/login.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(false);
  });

  it('should reject regions with empty name', () => {
    const raw = {
      regions: [
        { name: '', summary: 'Empty name', modules: ['src/a.ts'] },
      ],
    };
    const allModuleIds = ['src/a.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(false);
  });

  it('should reject regions with empty summary', () => {
    const raw = {
      regions: [
        { name: 'Auth', summary: '', modules: ['src/a.ts'] },
      ],
    };
    const allModuleIds = ['src/a.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(false);
  });
});

describe('Validate: orphan fixing', () => {
  it('should assign orphaned modules to the nearest region by directory proximity', () => {
    const raw = {
      regions: [
        { name: 'Auth', summary: 'Auth stuff', modules: ['src/auth/login.ts'] },
        { name: 'API', summary: 'API stuff', modules: ['src/api/handler.ts'] },
      ],
    };
    // src/auth/session.ts is orphaned — should be assigned to Auth (same directory)
    const allModuleIds = ['src/auth/login.ts', 'src/auth/session.ts', 'src/api/handler.ts'];

    const result = validateAndFix(raw, allModuleIds);

    expect(result.valid).toBe(true);
    const authRegion = result.regions.find(r => r.name === 'Auth');
    expect(authRegion).toBeDefined();
    expect(authRegion!.modules).toContain('src/auth/session.ts');
  });

  it('should handle all modules being orphaned', () => {
    const raw = {
      regions: [
        { name: 'Empty', summary: 'Nothing', modules: [] },
      ],
    };
    const allModuleIds = ['src/a.ts', 'src/b.ts'];

    const result = validateAndFix(raw, allModuleIds);

    // All orphans assigned somewhere
    const totalModules = result.regions.reduce((sum, r) => sum + r.modules.length, 0);
    expect(totalModules).toBe(2);
  });
});

describe('Validate: duplicate fixing', () => {
  it('should keep only the first assignment when a module appears in multiple regions', () => {
    const raw = {
      regions: [
        { name: 'Auth', summary: 'Auth stuff', modules: ['src/auth/login.ts', 'src/shared.ts'] },
        { name: 'API', summary: 'API stuff', modules: ['src/api/handler.ts', 'src/shared.ts'] }, // duplicate
      ],
    };
    const allModuleIds = ['src/auth/login.ts', 'src/api/handler.ts', 'src/shared.ts'];

    const result = validateAndFix(raw, allModuleIds);

    // shared.ts should only be in Auth (first assignment)
    const authRegion = result.regions.find(r => r.name === 'Auth');
    const apiRegion = result.regions.find(r => r.name === 'API');
    expect(authRegion!.modules).toContain('src/shared.ts');
    expect(apiRegion!.modules).not.toContain('src/shared.ts');

    // Total unique modules = 3
    const totalModules = result.regions.reduce((sum, r) => sum + r.modules.length, 0);
    expect(totalModules).toBe(3);
  });

  it('should handle a module duplicated across 3+ regions', () => {
    const raw = {
      regions: [
        { name: 'A', summary: 'A', modules: ['src/shared.ts'] },
        { name: 'B', summary: 'B', modules: ['src/shared.ts'] },
        { name: 'C', summary: 'C', modules: ['src/shared.ts', 'src/c.ts'] },
      ],
    };
    const allModuleIds = ['src/shared.ts', 'src/c.ts'];

    const result = validateAndFix(raw, allModuleIds);

    // shared.ts should only be in A (first assignment)
    const regionA = result.regions.find(r => r.name === 'A');
    expect(regionA!.modules).toContain('src/shared.ts');

    const totalShared = result.regions.filter(r => r.modules.includes('src/shared.ts')).length;
    expect(totalShared).toBe(1);
  });
});

describe('Validate: combined orphan + duplicate', () => {
  it('should fix both orphans and duplicates in the same response', () => {
    const raw = {
      regions: [
        { name: 'Auth', summary: 'Auth', modules: ['src/auth/login.ts', 'src/shared.ts'] },
        { name: 'API', summary: 'API', modules: ['src/shared.ts'] }, // duplicate
        // src/db/models.ts is orphaned
      ],
    };
    const allModuleIds = ['src/auth/login.ts', 'src/shared.ts', 'src/db/models.ts'];

    const result = validateAndFix(raw, allModuleIds);

    const totalModules = result.regions.reduce((sum, r) => sum + r.modules.length, 0);
    expect(totalModules).toBe(3);

    // shared.ts only in first assignment
    const regionsWithShared = result.regions.filter(r => r.modules.includes('src/shared.ts'));
    expect(regionsWithShared.length).toBe(1);
  });
});
