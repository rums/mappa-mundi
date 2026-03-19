import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Lens, LensType } from './types.js';
import { ALL_BUILTIN_LENSES } from './defaults.js';

const STORE_DIR = join(homedir(), '.mappa-mundi', 'lenses');

function lensFilePath(id: string): string {
  return join(STORE_DIR, `${id}.json`);
}

/**
 * File-based lens store.
 * Built-in lenses are always present unless a deletion marker exists.
 * User lenses are stored as individual JSON files.
 */
export class LensStore {
  private storeDir: string;

  constructor(storeDir?: string) {
    this.storeDir = storeDir ?? STORE_DIR;
  }

  private filePath(id: string): string {
    return join(this.storeDir, `${id}.json`);
  }

  private ensureDir(): void {
    mkdirSync(this.storeDir, { recursive: true });
  }

  /** List all lenses (built-in + user-created), optionally filtered by type. */
  list(type?: LensType): Lens[] {
    const lenses: Lens[] = [];

    // Load built-in lenses
    for (const builtin of ALL_BUILTIN_LENSES) {
      if (type && builtin.type !== type) continue;
      const lens: Lens = {
        ...builtin,
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      lenses.push(lens);
    }

    // Load user lenses from disk
    try {
      if (existsSync(this.storeDir)) {
        for (const file of readdirSync(this.storeDir)) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = JSON.parse(
              readFileSync(join(this.storeDir, file), 'utf-8'),
            ) as Lens & { deleted?: boolean };
            // Handle deletion markers for built-ins
            if (data.deleted) {
              const idx = lenses.findIndex((l) => l.id === data.id);
              if (idx >= 0) lenses.splice(idx, 1);
              continue;
            }
            if (type && data.type !== type) continue;
            // User lenses override built-in with same ID (shouldn't happen, but be safe)
            const idx = lenses.findIndex((l) => l.id === data.id);
            if (idx >= 0) {
              lenses[idx] = data;
            } else {
              lenses.push(data);
            }
          } catch {
            // Skip corrupt files
          }
        }
      }
    } catch {
      // Store dir unreadable — return built-ins only
    }

    return lenses;
  }

  /** Get a single lens by ID. */
  get(id: string): Lens | undefined {
    // Check user store first
    try {
      const fp = this.filePath(id);
      if (existsSync(fp)) {
        const data = JSON.parse(readFileSync(fp, 'utf-8')) as Lens & { deleted?: boolean };
        if (data.deleted) return undefined;
        return data;
      }
    } catch {
      // Fall through to built-in check
    }

    // Check built-ins
    const builtin = ALL_BUILTIN_LENSES.find((l) => l.id === id);
    if (builtin) {
      return { ...builtin, createdAt: '2025-01-01T00:00:00.000Z' };
    }

    return undefined;
  }

  /** Create a new user lens. Returns the created lens. */
  create(name: string, type: LensType, prompt: string): Lens {
    this.ensureDir();

    const id = `${type}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;

    // Avoid collisions
    let finalId = id;
    let counter = 1;
    while (existsSync(this.filePath(finalId)) || ALL_BUILTIN_LENSES.some((l) => l.id === finalId)) {
      finalId = `${id}-${counter++}`;
    }

    const lens: Lens = {
      id: finalId,
      name,
      type,
      prompt,
      createdAt: new Date().toISOString(),
      builtIn: false,
    };

    writeFileSync(this.filePath(finalId), JSON.stringify(lens, null, 2));
    return lens;
  }

  /** Delete a lens. Built-in lenses can be deleted (removes from list). */
  delete(id: string): boolean {
    // Check if it's a built-in — if so, write a deletion marker
    const isBuiltIn = ALL_BUILTIN_LENSES.some((l) => l.id === id);

    if (isBuiltIn) {
      // Write a marker file so we skip this built-in
      this.ensureDir();
      writeFileSync(
        this.filePath(id),
        JSON.stringify({ id, deleted: true }),
      );
      return true;
    }

    // User lens — delete the file
    try {
      const fp = this.filePath(id);
      if (existsSync(fp)) {
        unlinkSync(fp);
        return true;
      }
    } catch {
      // File already gone
    }

    return false;
  }
}
