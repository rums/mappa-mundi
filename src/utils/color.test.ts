import { describe, it, expect } from 'vitest';
import { regionColor, COLORBLIND_SAFE_PALETTE } from './color';

describe('regionColor: Deterministic Color Assignment', () => {
  it('returns the same color for the same region ID', () => {
    const color1 = regionColor('auth');
    const color2 = regionColor('auth');
    expect(color1).toBe(color2);
  });

  it('returns a color from the colorblind-safe palette', () => {
    const color = regionColor('some-region');
    expect(COLORBLIND_SAFE_PALETTE).toContain(color);
  });

  it('returns different colors for different region IDs (probabilistic)', () => {
    const ids = ['auth', 'api', 'db', 'ui', 'core', 'lib', 'test', 'docs'];
    const colors = ids.map(regionColor);
    const unique = new Set(colors);
    // With 8 IDs and 10 palette colors, we expect at least a few distinct colors
    expect(unique.size).toBeGreaterThan(1);
  });

  it('palette has exactly 10 colors', () => {
    expect(COLORBLIND_SAFE_PALETTE).toHaveLength(10);
  });

  it('handles empty string region ID without crashing', () => {
    expect(() => regionColor('')).not.toThrow();
    expect(COLORBLIND_SAFE_PALETTE).toContain(regionColor(''));
  });

  it('handles very long region IDs without crashing', () => {
    const longId = 'a'.repeat(1000);
    expect(() => regionColor(longId)).not.toThrow();
    expect(COLORBLIND_SAFE_PALETTE).toContain(regionColor(longId));
  });
});
