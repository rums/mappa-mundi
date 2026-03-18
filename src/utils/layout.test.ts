import { describe, it, expect } from 'vitest';
import { computeTreemapLayout, type LayoutRect } from './layout';
import type { Region } from '../types';

describe('computeTreemapLayout', () => {
  const regions: Region[] = [
    { id: 'a', name: 'A', moduleCount: 20, loc: 500 },
    { id: 'b', name: 'B', moduleCount: 10, loc: 300 },
    { id: 'c', name: 'C', moduleCount: 30, loc: 200 },
  ];

  it('returns one LayoutRect per region', () => {
    const rects = computeTreemapLayout(regions, 800, 600, 'modules');
    expect(rects).toHaveLength(3);
  });

  it('each rect has x, y, width, height, and regionId', () => {
    const rects = computeTreemapLayout(regions, 800, 600, 'modules');
    for (const rect of rects) {
      expect(rect).toHaveProperty('x');
      expect(rect).toHaveProperty('y');
      expect(rect).toHaveProperty('width');
      expect(rect).toHaveProperty('height');
      expect(rect).toHaveProperty('regionId');
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('rects fit within the specified dimensions', () => {
    const rects = computeTreemapLayout(regions, 800, 600, 'modules');
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(800);
      expect(rect.y + rect.height).toBeLessThanOrEqual(600);
    }
  });

  it('sizes regions proportionally by module count when sizeBy=modules', () => {
    const rects = computeTreemapLayout(regions, 800, 600, 'modules');
    const areaByRegion = new Map<string, number>();
    for (const r of rects) {
      areaByRegion.set(r.regionId, r.width * r.height);
    }
    // c has 30 modules, a has 20, b has 10 — areas should reflect this
    expect(areaByRegion.get('c')!).toBeGreaterThan(areaByRegion.get('a')!);
    expect(areaByRegion.get('a')!).toBeGreaterThan(areaByRegion.get('b')!);
  });

  it('sizes regions proportionally by LOC when sizeBy=loc', () => {
    const rects = computeTreemapLayout(regions, 800, 600, 'loc');
    const areaByRegion = new Map<string, number>();
    for (const r of rects) {
      areaByRegion.set(r.regionId, r.width * r.height);
    }
    // a has 500 LOC, b has 300, c has 200 — areas should reflect this
    expect(areaByRegion.get('a')!).toBeGreaterThan(areaByRegion.get('b')!);
    expect(areaByRegion.get('b')!).toBeGreaterThan(areaByRegion.get('c')!);
  });

  it('returns empty array for empty regions', () => {
    const rects = computeTreemapLayout([], 800, 600, 'modules');
    expect(rects).toHaveLength(0);
  });

  it('handles a single region (fills available space)', () => {
    const single = [{ id: 'only', name: 'Only', moduleCount: 10, loc: 100 }];
    const rects = computeTreemapLayout(single, 800, 600, 'modules');
    expect(rects).toHaveLength(1);
    expect(rects[0].width).toBeGreaterThan(700);
    expect(rects[0].height).toBeGreaterThan(500);
  });
});
