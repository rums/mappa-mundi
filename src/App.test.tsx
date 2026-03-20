import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SemanticZoomLevel } from './types';
import type { LayerScore } from './layers/types';

// ---------------------------------------------------------------------------
// Mock hook modules — these don't exist yet (spec #14).
// The mocks define the contract that the hooks must fulfill.
// ---------------------------------------------------------------------------

const mockScan = vi.fn();
const mockRefresh = vi.fn();
const mockSetQuery = vi.fn();
const mockImmediateSearch = vi.fn();
const mockActivateLayer = vi.fn();
const mockDeactivateLayer = vi.fn();

// Default hook return values — overridden per test as needed
let useScanReturn: {
  scan: typeof mockScan;
  refresh: typeof mockRefresh;
  status: 'idle' | 'scanning' | 'completed' | 'failed';
  data: SemanticZoomLevel | null;
  error: string | null;
};

let useZoomLevelReturn: {
  data: SemanticZoomLevel | null;
  loading: boolean;
  error: string | null;
};

let useLayersReturn: {
  layers: Array<{ id: string; name: string; description: string }>;
  activeLayerId: string | null;
  activateLayer: typeof mockActivateLayer;
  deactivateLayer: typeof mockDeactivateLayer;
  scores: Map<string, LayerScore> | null;
  scoresLoading: boolean;
};

let useSearchReturn: {
  query: string;
  setQuery: typeof mockSetQuery;
  results: Array<{
    id: string;
    name: string;
    kind: 'module' | 'symbol' | 'region';
    score: number;
    context?: string;
  }>;
  loading: boolean;
  error: string | null;
  search: typeof mockImmediateSearch;
};

vi.mock('./hooks/useScan', () => ({
  useScan: () => useScanReturn,
}));

vi.mock('./hooks/useZoomLevel', () => ({
  useZoomLevel: (_regionId: string | null) => useZoomLevelReturn,
}));

vi.mock('./hooks/useLayers', () => ({
  useLayers: () => useLayersReturn,
}));

vi.mock('./hooks/useSearch', () => ({
  useSearch: () => useSearchReturn,
}));

// Mock useHierarchy — used by the zoomable circle pack view
let useHierarchyReturn: {
  tree: import('./components/ZoomableCirclePackRenderer').HierarchyNode | null;
  loading: boolean;
  requestChildren: (regionId: string) => void;
};

const mockRequestChildren = vi.fn();

vi.mock('./hooks/useHierarchy', () => ({
  useHierarchy: () => useHierarchyReturn,
}));

// Mock useLenses
vi.mock('./hooks/useLenses', () => ({
  useLenses: () => ({
    compoundLenses: [],
    layerLenses: [],
    createLens: vi.fn(),
    deleteLens: vi.fn(),
  }),
}));

// Import App AFTER mocks are set up
import { App } from './App';
import type { HierarchyNode } from './components/ZoomableCirclePackRenderer';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRegion(id: string, name: string, moduleCount = 10, loc = 100) {
  return { id, name, moduleCount, loc };
}

const topLevelData: SemanticZoomLevel = {
  id: 'root',
  label: 'Root level',
  regions: [
    makeRegion('auth', 'Authentication', 20, 500),
    makeRegion('api', 'API Gateway', 15, 400),
    makeRegion('db', 'Database', 10, 300),
    makeRegion('ui', 'User Interface', 25, 600),
  ],
  relationships: [
    { sourceId: 'api', targetId: 'auth', kind: 'depends-on', edgeCount: 3 },
    { sourceId: 'api', targetId: 'db', kind: 'depends-on', edgeCount: 5 },
  ],
};

const subLevelData: SemanticZoomLevel = {
  id: 'auth-children',
  label: 'Authentication',
  regions: [
    makeRegion('auth/login', 'Login', 8, 200),
    makeRegion('auth/signup', 'Signup', 7, 180),
    makeRegion('auth/reset', 'Reset Password', 5, 120),
  ],
  relationships: [],
};

const sampleLayers = [
  { id: 'coverage', name: 'Test Coverage', description: 'Test coverage %' },
  { id: 'complexity', name: 'Complexity', description: 'Cyclomatic complexity' },
];

function makeLayerScores(): Map<string, LayerScore> {
  const scores = new Map<string, LayerScore>();
  scores.set('auth', { value: 0.85, raw: 85, label: '85%', severity: 'info' });
  scores.set('api', { value: 0.60, raw: 60, label: '60%', severity: 'warning' });
  scores.set('db', { value: 0.30, raw: 30, label: '30%', severity: 'critical' });
  scores.set('ui', { value: 0.70, raw: 70, label: '70%', severity: 'info' });
  return scores;
}

const sampleSearchResults = [
  { id: 'auth/login.ts', name: 'login.ts', kind: 'module' as const, score: 0.95, context: 'auth' },
  { id: 'auth/signup.ts', name: 'signup.ts', kind: 'module' as const, score: 0.80, context: 'auth' },
];

/** Build a HierarchyNode tree from SemanticZoomLevel data */
function buildHierarchyTree(data: SemanticZoomLevel): HierarchyNode {
  return {
    id: 'root',
    name: data.label || 'Project',
    moduleCount: data.regions.reduce((sum, r) => sum + r.moduleCount, 0),
    loc: data.regions.reduce((sum, r) => sum + r.loc, 0),
    children: data.regions.map((r) => ({
      id: r.id,
      name: r.name,
      moduleCount: r.moduleCount,
      loc: r.loc,
    })),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockScan.mockReset();
  mockRefresh.mockReset();
  mockSetQuery.mockReset();
  mockImmediateSearch.mockReset();
  mockActivateLayer.mockReset();
  mockDeactivateLayer.mockReset();

  useScanReturn = {
    scan: mockScan,
    refresh: mockRefresh,
    status: 'idle',
    data: null,
    error: null,
  };

  useZoomLevelReturn = {
    data: null,
    loading: false,
    error: null,
  };

  useLayersReturn = {
    layers: sampleLayers,
    activeLayerId: null,
    activateLayer: mockActivateLayer,
    deactivateLayer: mockDeactivateLayer,
    scores: null,
    scoresLoading: false,
  };

  useSearchReturn = {
    query: '',
    setQuery: mockSetQuery,
    results: [],
    loading: false,
    error: null,
    search: mockImmediateSearch,
  };

  mockRequestChildren.mockReset();
  useHierarchyReturn = {
    tree: null,
    loading: false,
    requestChildren: mockRequestChildren,
  };
});

// ---------------------------------------------------------------------------
// AC: User can scan a project path and see a treemap visualization
// ---------------------------------------------------------------------------

describe('App Integration: Scan → Map pipeline', () => {
  it('renders a path input and scan button in idle state', () => {
    render(<App />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
  });

  it('calls scan(path) when user enters a path and clicks Scan', async () => {
    render(<App />);
    const input = screen.getByRole('textbox');
    const scanButton = screen.getByRole('button', { name: /scan/i });

    await userEvent.type(input, '/my/project');
    await userEvent.click(scanButton);

    expect(mockScan).toHaveBeenCalledWith('/my/project', null);
  });

  it('disables the scan button when the path input is empty', () => {
    render(<App />);
    const scanButton = screen.getByRole('button', { name: /scan/i });
    expect(scanButton).toBeDisabled();
  });

  it('shows loading state while scanning', () => {
    useScanReturn = { ...useScanReturn, status: 'scanning' };
    useHierarchyReturn = { ...useHierarchyReturn, loading: true };
    render(<App />);
    // Shows spinner while scanning
    expect(screen.getByText(/scanning project/i)).toBeInTheDocument();
  });

  it('shows MapRenderer with data when scan completes', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    const { container } = render(<App />);
    // ZoomableCirclePackRenderer renders circles for regions
    const circles = container.querySelectorAll('circle[data-region-id]');
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });

  it('shows "Scan a project to begin" placeholder when idle with no data', () => {
    render(<App />);
    expect(screen.getByText(/scan a project to begin/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC: All error states show user-friendly messages
// ---------------------------------------------------------------------------

describe('App Integration: Scan error handling', () => {
  it('shows error message when scan fails', () => {
    useScanReturn = {
      ...useScanReturn,
      status: 'failed',
      error: 'Could not find tsconfig.json',
    };
    render(<App />);
    expect(screen.getByText(/could not find tsconfig\.json/i)).toBeInTheDocument();
  });

  it('shows a retry button when scan fails', async () => {
    useScanReturn = {
      ...useScanReturn,
      status: 'failed',
      error: 'Connection refused',
    };
    render(<App />);
    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('shows API unreachable banner when appropriate error is present', () => {
    useScanReturn = {
      ...useScanReturn,
      status: 'failed',
      error: 'Failed to fetch',
    };
    render(<App />);
    // Should show a helpful message about starting the API server
    expect(screen.getByText(/cannot connect|api server|start/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC: Single-click selects a region (visual highlight)
// ---------------------------------------------------------------------------

describe('App Integration: Region selection', () => {
  it('passes onRegionSelect handler to MapRenderer', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    const { container } = render(<App />);

    // In zoomable view, click a circle to zoom into it first, then click the focused node to select
    // The region circles are rendered as circle[data-region-id]
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    expect(authCircle).toBeTruthy();

    // First click zooms into the node (sets it as focus)
    await userEvent.click(authCircle!);
    // Second click on the now-focused node selects it
    await userEvent.click(authCircle!);

    // The region should be visually selected
    await waitFor(() => {
      const selectedEls = container.querySelectorAll('[data-selected="true"]');
      expect(selectedEls).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// AC: Double-click zooms into a region (fetches sub-level)
// ---------------------------------------------------------------------------

describe('App Integration: Zoom navigation', () => {
  it('renders breadcrumbs with Root when at top level', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    const { container } = render(<App />);
    const breadcrumbs = container.querySelectorAll('[data-breadcrumb]');
    expect(breadcrumbs.length).toBeGreaterThanOrEqual(1);
    expect(breadcrumbs[0].textContent).toMatch(/root/i);
  });

  it('zooms into a region on click and shows breadcrumb', async () => {
    const tree = buildHierarchyTree(topLevelData);
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree };

    const { container } = render(<App />);
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    expect(authCircle).toBeTruthy();

    // Click to zoom into the region
    await userEvent.click(authCircle!);

    await waitFor(() => {
      // Breadcrumbs should show the zoomed path including Authentication
      const breadcrumbs = container.querySelectorAll('[data-breadcrumb]');
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders child circles when hierarchy tree has children', () => {
    const tree = buildHierarchyTree(topLevelData);
    // Add sub-children to auth
    const authNode = tree.children?.find((c) => c.id === 'auth');
    if (authNode) {
      authNode.children = subLevelData.regions.map((r) => ({
        id: r.id,
        name: r.name,
        moduleCount: r.moduleCount,
        loc: r.loc,
      }));
    }
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree };

    const { container } = render(<App />);
    // Sub-level regions should be rendered as circles
    const loginCircle = container.querySelector('circle[data-region-id="auth/login"]');
    expect(loginCircle).toBeTruthy();
  });

  it('zooms out when clicking SVG background', async () => {
    const tree = buildHierarchyTree(topLevelData);
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree };

    const { container } = render(<App />);

    // Zoom into auth
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    await userEvent.click(authCircle!);

    // Now click the SVG background to zoom out
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    await userEvent.click(svg!);

    // Should show breadcrumbs back at root
    await waitFor(() => {
      const breadcrumbs = container.querySelectorAll('[data-breadcrumb]');
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows breadcrumbs that reflect the zoom path', async () => {
    const tree = buildHierarchyTree(topLevelData);
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree };

    const { container } = render(<App />);

    // Zoom into auth
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    await userEvent.click(authCircle!);

    await waitFor(() => {
      const breadcrumbs = container.querySelectorAll('[data-breadcrumb]');
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows loading indicator while hierarchy is loading', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData), loading: true };

    const { container } = render(<App />);
    // Should show "Loading deeper levels..." indicator
    expect(screen.getByText(/loading deeper levels/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC: Toggling a layer colors regions by score
// ---------------------------------------------------------------------------

describe('App Integration: Layer sidebar', () => {
  it('renders LayerPicker in the sidebar with available layers', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    render(<App />);

    expect(screen.getByText('Test Coverage')).toBeInTheDocument();
    expect(screen.getByText('Complexity')).toBeInTheDocument();
  });

  it('calls activateLayer when toggling a layer on', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    render(<App />);

    const coverageToggle = screen.getByLabelText(/test coverage/i);
    await userEvent.click(coverageToggle);

    expect(mockActivateLayer).toHaveBeenCalledWith('coverage');
  });

  it('passes region scores to MapRenderer when layer is active', () => {
    const scores = makeLayerScores();
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores,
    };

    const { container } = render(<App />);
    // ZoomableCirclePackRenderer renders circles for regions
    const circles = container.querySelectorAll('circle[data-region-id]');
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// AC: Selecting a region with active layer shows detail panel
// ---------------------------------------------------------------------------

describe('App Integration: Layer detail panel', () => {
  it('does not show LayerDetailPanel when no region is selected', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores: makeLayerScores(),
    };

    render(<App />);
    // Panel should not be visible without a region selected
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('does not show LayerDetailPanel when no layer is active', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    const { container } = render(<App />);

    // In zoomable view: first click zooms, second click selects
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    await userEvent.click(authCircle!);
    await userEvent.click(authCircle!);

    // Panel should not appear without an active layer
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });

  it('shows LayerDetailPanel when region is selected AND layer is active', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores: makeLayerScores(),
    };

    const { container } = render(<App />);

    // In zoomable view: first click zooms, second click selects
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    await userEvent.click(authCircle!);
    await userEvent.click(authCircle!);

    await waitFor(() => {
      // LayerDetailPanel should show close button and region name
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      // Region name appears in the detail panel (and also in the map, so use getAllByText)
      expect(screen.getAllByText('Authentication').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('closes LayerDetailPanel when close button is clicked', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores: makeLayerScores(),
    };

    const { container } = render(<App />);

    // In zoomable view: first click zooms, second click selects
    const authCircle = container.querySelector('circle[data-region-id="auth"]');
    await userEvent.click(authCircle!);
    await userEvent.click(authCircle!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    // Click close
    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    // Panel should disappear (region deselected)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// AC: Search input finds and highlights regions
// ---------------------------------------------------------------------------

describe('App Integration: Search', () => {
  it('renders a search input in the header', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('calls setQuery when user types in search input', async () => {
    render(<App />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    await userEvent.type(searchInput, 'login');

    // setQuery should have been called for each character (or debounced)
    expect(mockSetQuery).toHaveBeenCalled();
  });

  it('shows search results dropdown when results are available', () => {
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      results: sampleSearchResults,
    };
    render(<App />);

    expect(screen.getByText('login.ts')).toBeInTheDocument();
    expect(screen.getByText('signup.ts')).toBeInTheDocument();
  });

  it('shows kind badge for each search result', () => {
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      results: sampleSearchResults,
    };
    const { container } = render(<App />);

    // Each result should show a badge indicating its kind (module/symbol/region)
    const badges = container.querySelectorAll('[data-kind]');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('selects the matching region when clicking a search result', async () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      results: [
        { id: 'auth/login.ts', name: 'login.ts', kind: 'module', score: 0.95, context: 'auth' },
      ],
    };

    const { container } = render(<App />);

    // Click the search result
    await userEvent.click(screen.getByText('login.ts'));

    // The dropdown should close and the region should be selected
    await waitFor(() => {
      const selected = container.querySelectorAll('[data-selected="true"]');
      expect(selected.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('closes dropdown when pressing Escape', async () => {
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      results: sampleSearchResults,
    };

    render(<App />);
    expect(screen.getByText('login.ts')).toBeInTheDocument();

    // Press Escape
    await userEvent.keyboard('{Escape}');

    // Dropdown should be dismissed
    await waitFor(() => {
      expect(screen.queryByText('login.ts')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown when clicking outside', async () => {
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      results: sampleSearchResults,
    };

    render(<App />);
    expect(screen.getByText('login.ts')).toBeInTheDocument();

    // Click outside the dropdown
    await userEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByText('login.ts')).not.toBeInTheDocument();
    });
  });

  it('shows "Search unavailable" when search errors', () => {
    useSearchReturn = {
      ...useSearchReturn,
      query: 'login',
      error: 'Search service unavailable',
      results: [],
    };

    render(<App />);
    expect(screen.getByText(/search unavailable/i)).toBeInTheDocument();
  });

  it('limits visible results to 20', () => {
    const manyResults = Array.from({ length: 25 }, (_, i) => ({
      id: `mod-${i}`,
      name: `module-${i}.ts`,
      kind: 'module' as const,
      score: 0.5,
    }));
    useSearchReturn = {
      ...useSearchReturn,
      query: 'module',
      results: manyResults,
    };

    const { container } = render(<App />);
    const resultItems = container.querySelectorAll('[data-search-result]');
    expect(resultItems.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// AC: Error handling for layer fetch failures
// ---------------------------------------------------------------------------

describe('App Integration: Layer error handling', () => {
  it('shows inline error when layer score fetch fails', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useHierarchyReturn = { ...useHierarchyReturn, tree: buildHierarchyTree(topLevelData) };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores: null,
      scoresLoading: false,
    };
    // Simulate an error state — the layer is active but scores are null
    // (the actual error would come from the hook — here we verify the UI handles it)
    render(<App />);
    // App should show inline message about scores not being available
    expect(screen.getByText(/layer scores could not be computed/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC: No console errors in normal operation
// ---------------------------------------------------------------------------

describe('App Integration: No crashes', () => {
  it('renders without errors in idle state', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders without errors with full data and active layer', () => {
    useScanReturn = { ...useScanReturn, status: 'completed', data: topLevelData };
    useLayersReturn = {
      ...useLayersReturn,
      activeLayerId: 'coverage',
      scores: makeLayerScores(),
    };
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders without errors when all hooks return error states', () => {
    useScanReturn = { ...useScanReturn, status: 'failed', error: 'Scan failed' };
    useZoomLevelReturn = { data: null, loading: false, error: 'Zoom failed' };
    useSearchReturn = { ...useSearchReturn, error: 'Search failed' };
    expect(() => render(<App />)).not.toThrow();
  });
});
