import { describe, it, expect } from 'vitest';
import { interpolateColor, scoreToColor } from './colorScale';
import type { ColorScale } from './colorScale';

// ---------------------------------------------------------------------------
// AC 6: Color scale — interpolation between low/high colors
// ---------------------------------------------------------------------------

describe('colorScale: interpolateColor', () => {
  const redToGreen: ColorScale = {
    low: '#d32f2f',
    high: '#388e3c',
  };

  const withMidpoint: ColorScale = {
    low: '#d32f2f',
    high: '#388e3c',
    midpoint: '#fbc02d',
  };

  it('returns exactly the low color for value 0', () => {
    const result = interpolateColor(0, redToGreen);
    expect(result).toBe('#d32f2f');
  });

  it('returns exactly the high color for value 1', () => {
    const result = interpolateColor(1, redToGreen);
    expect(result).toBe('#388e3c');
  });

  it('returns a blended color for value 0.5 (two-stop)', () => {
    const result = interpolateColor(0.5, redToGreen);
    // Should not be exactly low or high
    expect(result).not.toBe('#d32f2f');
    expect(result).not.toBe('#388e3c');
    // Should be a valid hex color
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('uses midpoint color when defined (three-stop gradient)', () => {
    const atMidpoint = interpolateColor(0.5, withMidpoint);
    // At midpoint, should be close to the midpoint color
    expect(atMidpoint).toBe('#fbc02d');
  });

  it('interpolates smoothly between low and midpoint for values 0-0.5', () => {
    const result = interpolateColor(0.25, withMidpoint);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Should not be any of the stop colors
    expect(result).not.toBe('#d32f2f');
    expect(result).not.toBe('#fbc02d');
  });

  it('interpolates smoothly between midpoint and high for values 0.5-1', () => {
    const result = interpolateColor(0.75, withMidpoint);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(result).not.toBe('#fbc02d');
    expect(result).not.toBe('#388e3c');
  });

  it('clamps values below 0 to the low color', () => {
    const result = interpolateColor(-0.5, redToGreen);
    expect(result).toBe('#d32f2f');
  });

  it('clamps values above 1 to the high color', () => {
    const result = interpolateColor(1.5, redToGreen);
    expect(result).toBe('#388e3c');
  });
});

// ---------------------------------------------------------------------------
// AC 6: scoreToColor — maps LayerScore value to a color, with fallback
// ---------------------------------------------------------------------------

describe('colorScale: scoreToColor', () => {
  const scale: ColorScale = {
    low: '#d32f2f',
    high: '#388e3c',
  };

  const NEUTRAL_GRAY = '#9e9e9e';

  it('maps score 0.9 to a green-ish color (high end)', () => {
    const result = scoreToColor(0.9, scale);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Should be closer to high (green) — not the neutral gray
    expect(result).not.toBe(NEUTRAL_GRAY);
  });

  it('maps score 0.3 to a red-ish color (low end)', () => {
    const result = scoreToColor(0.3, scale);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(result).not.toBe(NEUTRAL_GRAY);
  });

  it('returns neutral gray for undefined score', () => {
    const result = scoreToColor(undefined, scale);
    expect(result).toBe(NEUTRAL_GRAY);
  });

  it('returns neutral gray for NaN score', () => {
    const result = scoreToColor(NaN, scale);
    expect(result).toBe(NEUTRAL_GRAY);
  });
});
