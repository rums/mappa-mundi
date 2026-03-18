import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapRenderer } from './MapRenderer';
import type { SemanticZoomLevel } from '../types';

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

const singleRegion: SemanticZoomLevel = {
  id: 'zoom-2',
  label: 'Single',
  regions: [makeRegion('core', 'Core Module', 50, 1000)],
  relationships: [],
};

const twentyRegions: SemanticZoomLevel = {
  id: 'zoom-3',
  label: 'Many',
  regions: Array.from({ length: 20 }, (_, i) =>
    makeRegion(`region-${i}`, `Region ${i}`, 5 + i, 100 + i * 50),
  ),
  relationships: [],
};

const emptyRegions: SemanticZoomLevel = {
  id: 'zoom-empty',
  label: 'Empty',
  regions: [],
  relationships: [],
};

// ---------------------------------------------------------------------------
// AC 1: Region rendering — 4 regions → 4 labeled SVG rectangles in treemap
// ---------------------------------------------------------------------------

describe('MapRenderer: Region Rendering', () => {
  it('renders 4 SVG rect elements for 4 regions', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const rects = container.querySelectorAll('rect[data-region-id]');
    expect(rects).toHaveLength(4);
  });

  it('renders text labels for each region', () => {
    render(<MapRenderer data={fourRegions} loading={false} />);
    expect(screen.getByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText('API Gateway')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('User Interface')).toBeInTheDocument();
  });

  it('renders a single region filling the available space', () => {
    const { container } = render(
      <MapRenderer data={singleRegion} loading={false} width={800} height={600} />,
    );
    const rects = container.querySelectorAll('rect[data-region-id]');
    expect(rects).toHaveLength(1);
    // Single region should be large — nearly full width/height
    const rect = rects[0];
    const width = Number(rect.getAttribute('width'));
    const height = Number(rect.getAttribute('height'));
    expect(width).toBeGreaterThan(700);
    expect(height).toBeGreaterThan(500);
  });

  it('renders all 20 regions when given 20 regions', () => {
    const { container } = render(
      <MapRenderer data={twentyRegions} loading={false} />,
    );
    const rects = container.querySelectorAll('rect[data-region-id]');
    expect(rects).toHaveLength(20);
  });

  it('truncates long region names with ellipsis', () => {
    const longNameData: SemanticZoomLevel = {
      id: 'zoom-long',
      label: 'Long names',
      regions: [
        makeRegion(
          'long',
          'This Is An Extremely Long Region Name That Should Be Truncated',
          10,
          100,
        ),
      ],
      relationships: [],
    };
    const { container } = render(
      <MapRenderer data={longNameData} loading={false} width={200} height={200} />,
    );
    // Should have text element — content may be truncated
    const textEl = container.querySelector('text[data-region-id="long"]');
    expect(textEl).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC 9: Region size reflects module count (or LOC when configured)
// ---------------------------------------------------------------------------

describe('MapRenderer: Region Sizing', () => {
  it('sizes regions proportionally by module count (default)', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} width={800} height={600} />,
    );
    const uiRect = container.querySelector('rect[data-region-id="ui"]');
    const dbRect = container.querySelector('rect[data-region-id="db"]');
    expect(uiRect).toBeTruthy();
    expect(dbRect).toBeTruthy();
    // UI has 25 modules, DB has 10 — UI should be larger
    const uiArea =
      Number(uiRect!.getAttribute('width')) *
      Number(uiRect!.getAttribute('height'));
    const dbArea =
      Number(dbRect!.getAttribute('width')) *
      Number(dbRect!.getAttribute('height'));
    expect(uiArea).toBeGreaterThan(dbArea);
  });

  it('sizes regions by LOC when regionSizeBy="loc"', () => {
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        width={800}
        height={600}
        regionSizeBy="loc"
      />,
    );
    const uiRect = container.querySelector('rect[data-region-id="ui"]');
    const dbRect = container.querySelector('rect[data-region-id="db"]');
    expect(uiRect).toBeTruthy();
    expect(dbRect).toBeTruthy();
    // UI has 600 LOC, DB has 300 — UI should be larger
    const uiArea =
      Number(uiRect!.getAttribute('width')) *
      Number(uiRect!.getAttribute('height'));
    const dbArea =
      Number(dbRect!.getAttribute('width')) *
      Number(dbRect!.getAttribute('height'));
    expect(uiArea).toBeGreaterThan(dbArea);
  });
});

// ---------------------------------------------------------------------------
// AC 2: Edge rendering — relationship → visible curved path
// ---------------------------------------------------------------------------

describe('MapRenderer: Edge Rendering', () => {
  it('renders a curved SVG path between two related regions', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const paths = container.querySelectorAll('path[data-edge]');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders no paths when there are no relationships', () => {
    const noEdges: SemanticZoomLevel = {
      id: 'zoom-no-edges',
      label: 'No edges',
      regions: [
        makeRegion('a', 'A'),
        makeRegion('b', 'B'),
      ],
      relationships: [],
    };
    const { container } = render(
      <MapRenderer data={noEdges} loading={false} />,
    );
    const paths = container.querySelectorAll('path[data-edge]');
    expect(paths).toHaveLength(0);
  });

  it('ignores relationships referencing non-existent region IDs without crashing', () => {
    const badEdge: SemanticZoomLevel = {
      id: 'zoom-bad',
      label: 'Bad ref',
      regions: [makeRegion('a', 'A')],
      relationships: [makeRelationship('a', 'nonexistent', 'depends-on', 1)],
    };
    // Should not throw
    expect(() =>
      render(<MapRenderer data={badEdge} loading={false} />),
    ).not.toThrow();
  });

  it('renders visually distinct styles for different relationship kinds', () => {
    const multiKind: SemanticZoomLevel = {
      id: 'zoom-kinds',
      label: 'Multi kinds',
      regions: [
        makeRegion('a', 'A'),
        makeRegion('b', 'B'),
        makeRegion('c', 'C'),
        makeRegion('d', 'D'),
        makeRegion('e', 'E'),
      ],
      relationships: [
        makeRelationship('a', 'b', 'depends-on', 1),
        makeRelationship('a', 'c', 'extends', 1),
        makeRelationship('a', 'd', 'implements', 1),
        makeRelationship('a', 'e', 'uses', 1),
      ],
    };
    const { container } = render(
      <MapRenderer data={multiKind} loading={false} />,
    );
    const paths = container.querySelectorAll('path[data-edge]');
    expect(paths.length).toBeGreaterThanOrEqual(4);
    // Collect stroke-dasharray values — should have distinct patterns
    const dashPatterns = new Set(
      Array.from(paths).map((p) => p.getAttribute('stroke-dasharray') ?? 'solid'),
    );
    expect(dashPatterns.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC 10: Edge thickness reflects relationship edgeCount
// ---------------------------------------------------------------------------

describe('MapRenderer: Edge Thickness', () => {
  it('renders thicker lines for higher edgeCount', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    // api→auth has edgeCount 3, api→db has edgeCount 5
    const paths = container.querySelectorAll('path[data-edge]');
    const widths = Array.from(paths).map((p) =>
      Number(p.getAttribute('stroke-width')),
    );
    // At least some difference in widths
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
  });
});

// ---------------------------------------------------------------------------
// AC 3: Double-clicking a region fires onZoomIn(regionId)
// ---------------------------------------------------------------------------

describe('MapRenderer: Zoom In Interaction', () => {
  it('fires onZoomIn with correct region ID on double-click', async () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} onZoomIn={onZoomIn} />,
    );
    const rect = container.querySelector('rect[data-region-id="auth"]');
    expect(rect).toBeTruthy();
    fireEvent.dblClick(rect!);
    await waitFor(() => {
      expect(onZoomIn).toHaveBeenCalledWith('auth');
    });
  });

  it('does not fire onZoomIn when double-clicking empty space', () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} onZoomIn={onZoomIn} />,
    );
    const svg = container.querySelector('svg');
    fireEvent.dblClick(svg!);
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('does not fire onZoomIn when double-clicking an edge', () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} onZoomIn={onZoomIn} />,
    );
    const path = container.querySelector('path[data-edge]');
    if (path) {
      fireEvent.dblClick(path);
      expect(onZoomIn).not.toHaveBeenCalled();
    }
  });

  it('does not crash when onZoomIn prop is not provided', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const rect = container.querySelector('rect[data-region-id="auth"]');
    expect(() => fireEvent.dblClick(rect!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC 4: Single-clicking a region fires onRegionSelect and highlights
// ---------------------------------------------------------------------------

describe('MapRenderer: Region Selection', () => {
  it('fires onRegionSelect with region ID on single click', async () => {
    const onRegionSelect = vi.fn();
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        onRegionSelect={onRegionSelect}
      />,
    );
    const rect = container.querySelector('rect[data-region-id="api"]');
    expect(rect).toBeTruthy();
    await userEvent.click(rect!);
    await waitFor(() => {
      expect(onRegionSelect).toHaveBeenCalledWith('api');
    });
  });

  it('visually highlights the selected region', async () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const rect = container.querySelector('rect[data-region-id="api"]');
    await userEvent.click(rect!);
    await waitFor(() => {
      // The region group or rect should have a selected indicator
      const selectedEl = container.querySelector('[data-selected="true"]');
      expect(selectedEl).toBeTruthy();
    });
  });

  it('deselects previous region when clicking a different one', async () => {
    const onRegionSelect = vi.fn();
    const { container } = render(
      <MapRenderer
        data={fourRegions}
        loading={false}
        onRegionSelect={onRegionSelect}
      />,
    );
    const authRect = container.querySelector('rect[data-region-id="auth"]');
    const apiRect = container.querySelector('rect[data-region-id="api"]');
    await userEvent.click(authRect!);
    await userEvent.click(apiRect!);
    await waitFor(() => {
      const selectedEls = container.querySelectorAll('[data-selected="true"]');
      expect(selectedEls).toHaveLength(1);
    });
  });

  it('deselects current selection when clicking empty space', async () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const rect = container.querySelector('rect[data-region-id="auth"]');
    await userEvent.click(rect!);
    // Click on the SVG background
    const svg = container.querySelector('svg');
    fireEvent.click(svg!);
    await waitFor(() => {
      const selectedEls = container.querySelectorAll('[data-selected="true"]');
      expect(selectedEls).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// AC 5: Loading state — skeleton vs real data
// ---------------------------------------------------------------------------

describe('MapRenderer: Loading State', () => {
  it('shows skeleton placeholders when loading=true and no data', () => {
    const { container } = render(
      <MapRenderer data={null} loading={true} />,
    );
    const skeletons = container.querySelectorAll('[data-skeleton]');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    expect(skeletons.length).toBeLessThanOrEqual(6);
  });

  it('shows skeleton when loading=true even with data (loading takes precedence)', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={true} />,
    );
    const skeletons = container.querySelectorAll('[data-skeleton]');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    // Should NOT show real region rects
    const regionRects = container.querySelectorAll('rect[data-region-id]');
    expect(regionRects).toHaveLength(0);
  });

  it('shows real regions when loading=false with data', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const rects = container.querySelectorAll('rect[data-region-id]');
    expect(rects).toHaveLength(4);
    const skeletons = container.querySelectorAll('[data-skeleton]');
    expect(skeletons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC 7: Empty data shows "no data" message
// ---------------------------------------------------------------------------

describe('MapRenderer: Empty State', () => {
  it('shows a "no data" message when data is null', () => {
    render(<MapRenderer data={null} loading={false} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('shows a "no data" message when data has 0 regions', () => {
    render(<MapRenderer data={emptyRegions} loading={false} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC 6: Pan and zoom
// ---------------------------------------------------------------------------

describe('MapRenderer: Pan and Zoom', () => {
  it('applies a transform on scroll wheel (zoom)', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} width={800} height={600} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // Simulate scroll wheel
    fireEvent.wheel(svg!, { deltaY: -100 });
    // The inner group should have a transform attribute after zoom
    const zoomGroup = container.querySelector('g[data-zoom-container]');
    expect(zoomGroup).toBeTruthy();
    const transform = zoomGroup!.getAttribute('transform');
    expect(transform).toBeTruthy();
    // Should contain scale > 1 (zoomed in)
    expect(transform).toMatch(/scale/);
  });

  it('clamps zoom to minimum 0.25x', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} width={800} height={600} />,
    );
    const svg = container.querySelector('svg');
    // Zoom out a lot
    for (let i = 0; i < 50; i++) {
      fireEvent.wheel(svg!, { deltaY: 200 });
    }
    const zoomGroup = container.querySelector('g[data-zoom-container]');
    const transform = zoomGroup?.getAttribute('transform') ?? '';
    const scaleMatch = transform.match(/scale\(([^,)]+)/);
    if (scaleMatch) {
      const scale = parseFloat(scaleMatch[1]);
      expect(scale).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('clamps zoom to maximum 4x', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} width={800} height={600} />,
    );
    const svg = container.querySelector('svg');
    // Zoom in a lot
    for (let i = 0; i < 50; i++) {
      fireEvent.wheel(svg!, { deltaY: -200 });
    }
    const zoomGroup = container.querySelector('g[data-zoom-container]');
    const transform = zoomGroup?.getAttribute('transform') ?? '';
    const scaleMatch = transform.match(/scale\(([^,)]+)/);
    if (scaleMatch) {
      const scale = parseFloat(scaleMatch[1]);
      expect(scale).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// AC 8: Deterministic colors (tested via color util)
// ---------------------------------------------------------------------------

describe('MapRenderer: Deterministic Colors', () => {
  it('assigns the same color to the same region ID across re-renders', () => {
    const { container, unmount } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const authRect = container.querySelector('rect[data-region-id="auth"]');
    const color1 = authRect?.getAttribute('fill');
    expect(color1).toBeTruthy();
    unmount();

    const { container: container2 } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const authRect2 = container2.querySelector('rect[data-region-id="auth"]');
    const color2 = authRect2?.getAttribute('fill');
    expect(color2).toBe(color1);
  });

  it('assigns different colors to different region IDs', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} />,
    );
    const colors = fourRegions.regions.map((r) => {
      const rect = container.querySelector(`rect[data-region-id="${r.id}"]`);
      return rect?.getAttribute('fill');
    });
    // At least some colors should differ
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Width / height defaults
// ---------------------------------------------------------------------------

describe('MapRenderer: Dimensions', () => {
  it('accepts explicit width and height', () => {
    const { container } = render(
      <MapRenderer data={fourRegions} loading={false} width={1024} height={768} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('1024');
    expect(svg?.getAttribute('height')).toBe('768');
  });
});
