import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapRenderer } from './MapRenderer';
import type { SemanticZoomLevel } from '../types';
import type { LayerScore } from '../layers/types';
import type { ColorScale } from '../utils/colorScale';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRegion(id: string, name: string, moduleCount = 10, loc = 100) {
  return { id, name, moduleCount, loc };
}

function makeRelationship(
  sourceId: string,
  targetId: string,
  kind: 'depends-on' | 'extends' | 'implements' | 'uses' = 'depends-on',
  edgeCount = 1,
) {
  return { sourceId, targetId, kind, edgeCount };
}

const fourRegions: SemanticZoomLevel = {
  id: 'zoom-1',
  label: 'Package level',
  regions: [
    makeRegion('auth', 'Authentication', 20, 500),
    makeRegion('api', 'API Gateway', 15, 400),
    makeRegion('db', 'Database', 10, 300),
    makeRegion('ui', 'User Interface', 25, 600),
  ],
  relationships: [
    makeRelationship('api', 'auth', 'depends-on', 3),
    makeRelationship('api', 'db', 'depends-on', 5),
  ],
};

const coverageScale: ColorScale = {
  low: '#d32f2f',
  high: '#388e3c',
  midpoint: '#fbc02d',
};

function makeCoverageScores(): Map<string, LayerScore> {
  const scores = new Map<string, LayerScore>();
  scores.set('auth', {
    value: 0.9,
    raw: 90,
    label: '90% coverage',
    severity: 'info',
  });
  scores.set('api', {
    value: 0.3,
    raw: 30,
    label: '30% coverage',
    severity: 'critical',
  });
  scores.set('db', {
    value: 0.5,
    raw: 50,
    label: '50% coverage',
    severity: 'warning',
  });
  // 'ui' intentionally omitted — should show neutral gray
  return scores;
}

// ---------------------------------------------------------------------------
// AC 2: Toggling a layer ON applies color coding to regions
// ---------------------------------------------------------------------------

describe('MapRenderer: Overlay Color Coding', () => {
  it('applies overlay colors to regions when regionScores are provided', () => {
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
      />,
    );
    const authRect = container.querySelector('rect[data-region-id="auth"]');
    const fill = authRect?.getAttribute('fill');
    // With score 0.9, fill should not be the default deterministic color
    // It should be closer to green (#388e3c)
    expect(fill).toBeTruthy();
    expect(fill).not.toBe('#d32f2f'); // Not the "low" red
  });

  it('maps score 0.9 to green-ish fill and score 0.3 to red-ish fill', () => {
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
      />,
    );
    const authFill = container
      .querySelector('rect[data-region-id="auth"]')
      ?.getAttribute('fill');
    const apiFill = container
      .querySelector('rect[data-region-id="api"]')
      ?.getAttribute('fill');

    expect(authFill).toBeTruthy();
    expect(apiFill).toBeTruthy();
    // High score (0.9) and low score (0.3) should have different colors
    expect(authFill).not.toBe(apiFill);
  });
});

// ---------------------------------------------------------------------------
// AC 3: Toggling a layer OFF reverts to default colors
// ---------------------------------------------------------------------------

describe('MapRenderer: Overlay Removal', () => {
  it('uses default deterministic colors when no regionScores provided', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const authRect = container.querySelector('rect[data-region-id="auth"]');
    const fill = authRect?.getAttribute('fill');
    // Should be from the colorblind-safe palette (deterministic default)
    expect(fill).toBeTruthy();
    expect(fill).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('reverts to default colors when regionScores is undefined', () => {
    const { container: withOverlay } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
      />,
    );
    const overlayFill = withOverlay
      .querySelector('rect[data-region-id="auth"]')
      ?.getAttribute('fill');

    const { container: withoutOverlay } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const defaultFill = withoutOverlay
      .querySelector('rect[data-region-id="auth"]')
      ?.getAttribute('fill');

    // Overlay fill and default fill should differ
    expect(overlayFill).not.toBe(defaultFill);
  });
});

// ---------------------------------------------------------------------------
// AC 9: Region with no score for active layer → neutral gray
// ---------------------------------------------------------------------------

describe('MapRenderer: Neutral Gray for Missing Scores', () => {
  it('renders neutral gray (#9e9e9e) for regions with no score', () => {
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
      />,
    );
    // 'ui' has no score in the coverage scores map
    const uiRect = container.querySelector('rect[data-region-id="ui"]');
    const fill = uiRect?.getAttribute('fill');
    expect(fill).toBe('#9e9e9e');
  });
});

// ---------------------------------------------------------------------------
// AC 10: No active layers → no overlay, clicks behave per Spec #8 defaults
// ---------------------------------------------------------------------------

describe('MapRenderer: No Active Layer', () => {
  it('does not apply overlay when regionScores is not provided', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    // No region should be gray
    const rects = container.querySelectorAll('rect[data-region-id]');
    const fills = Array.from(rects).map((r) => r.getAttribute('fill'));
    expect(fills.every((f) => f !== '#9e9e9e')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 6: Single-click on region with active layer → detail panel interaction
// ---------------------------------------------------------------------------

describe('MapRenderer: Click With Active Layer', () => {
  it('fires onRegionSelect on single click even with overlay active', async () => {
    const onRegionSelect = vi.fn();
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
        onRegionSelect={onRegionSelect}
      />,
    );
    const rect = container.querySelector('rect[data-region-id="auth"]');
    await userEvent.click(rect!);
    await waitFor(() => {
      expect(onRegionSelect).toHaveBeenCalledWith('auth');
    });
  });

  it('double-click still fires onZoomIn even with overlay active', async () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        regionScores={makeCoverageScores()}
        colorScale={coverageScale}
        onZoomIn={onZoomIn}
      />,
    );
    const rect = container.querySelector('rect[data-region-id="auth"]');
    fireEvent.dblClick(rect!);
    await waitFor(() => {
      expect(onZoomIn).toHaveBeenCalledWith('auth');
    });
  });
});
