# Spec 08: Web Visualizer — Canvas Renderer with Pan/Zoom

> GitHub Issue: #8
> Dependencies: Spec #4 (SemanticZoomLevel data model)
> Status: ready for TDD

## Intent

Build the core map renderer — an SVG-based D3.js visualization wrapped in a React component. Displays semantic regions as interactive areas with pan/zoom navigation, relationship edges, and loading states.

## Scope

### In Scope
- React component consuming SemanticZoomLevel data
- SVG rendering via D3.js (treemap layout for regions)
- Region visualization: labeled, colored, sized areas
- Relationship edges overlaid on regions
- Pan (mouse drag) and zoom (scroll wheel) interaction
- Double-click to zoom into a region (fires callback)
- Single-click to select a region (fires callback)
- Loading/skeleton state
- Empty/no-data state
- Deterministic region colors (hash-based)

### Out of Scope
- Canvas rendering (defer to v2 if SVG performance is insufficient at >100 regions)
- Touch/mobile gestures (pinch-to-zoom) — future enhancement
- Accessibility (keyboard nav, screen reader) — separate spec
- Layer overlays (that's Spec #9)

## Component API

```typescript
interface MapRendererProps {
  data: SemanticZoomLevel | null;
  loading: boolean;
  onZoomIn?: (regionId: string) => void;
  onRegionSelect?: (regionId: string) => void;
  width?: number;       // default: container width
  height?: number;      // default: container height
  regionSizeBy?: 'modules' | 'loc';  // default: 'modules'
}
```

## Design Decisions

1. **SVG first**: easier to test (DOM queryable), easier to debug (devtools inspectable), supports CSS styling. Migrate to Canvas only if performance degrades at >100 regions.
2. **Treemap layout**: space-filling layout via `d3-treemap`. Better "map" metaphor than force-directed. Relationship edges drawn as curved overlays on top.
3. **Region sizing**: configurable via `regionSizeBy` prop. Default: sized by module count. Alternative: sized by LOC.
4. **Color assignment**: deterministic based on region ID hash. Same region always gets same color across renders and sessions. Palette: 10 distinct, colorblind-safe hues.
5. **Zoom bounds**: min zoom 0.25x, max zoom 4x. "Fit to view" resets to 1x.
6. **Pan bounds**: unconstrained (free panning). User can pan content off-screen — a "fit to view" button recenters.
7. **Double-click vs single-click**: single-click selects (highlights region, fires `onRegionSelect`). Double-click zooms in (fires `onZoomIn`). 300ms delay to distinguish.
8. **Loading state**: when `loading=true`, render 4-6 pulsing gray rectangles in treemap layout as skeleton placeholders. Transition smoothly to real data when loading completes.
9. **Edge rendering**: curved Bezier paths between region centers. Thicker lines for higher `edgeCount`. Different dash patterns for different relationship kinds.

## Acceptance Criteria

1. Given a SemanticZoomLevel with 4 regions, renders 4 labeled SVG rectangles in treemap layout
2. Given 2 regions with a "depends-on" relationship, a visible curved path connects them
3. Double-clicking a region fires `onZoomIn(regionId)`
4. Single-clicking a region fires `onRegionSelect(regionId)` and visually highlights it
5. `loading=true` shows skeleton placeholder rectangles; `loading=false` shows real data
6. Pan (drag) and zoom (scroll) work; 2x zoom makes content 2x larger
7. Empty data (null or 0 regions) shows a "no data" message
8. Regions are colored deterministically — same region ID always gets same color
9. Region size reflects module count (or LOC when configured)
10. Edge thickness reflects relationship `edgeCount`

## Test Plan

### Behavior 1: Region rendering
- 4 regions → 4 SVG rect elements with text labels
- 1 region → fills available space
- 20 regions → all rendered, small ones may hide labels
- Region with long name → truncated with ellipsis
- Regions sized proportionally by module count

### Behavior 2: Edge rendering
- 2 regions with relationship → SVG path element between them
- No relationships → no path elements
- Multiple relationships between same pair → visually distinct (parallel curves or merged)
- Relationship to non-existent region ID → ignored (no crash)
- 4 relationship kinds → 4 distinct visual styles (dash patterns)

### Behavior 3: Interaction - zoom in
- Double-click region → `onZoomIn` called with correct region ID
- Double-click empty space → no callback
- Double-click edge → no callback
- No `onZoomIn` prop → no crash
- Triple-click → fires once, not twice

### Behavior 4: Interaction - select
- Single-click region → `onRegionSelect` called, region highlighted
- Click different region → previous deselected, new one selected
- Click empty space → deselects current selection

### Behavior 5: Loading state
- `loading=true`, no data → skeleton placeholders
- `loading=true`, with data → skeleton (loading takes precedence)
- `loading=false`, with data → real regions rendered
- `loading=false`, no data → "no data" message
- Transition from loading to loaded → smooth (no flash)

### Behavior 6: Pan and zoom
- Scroll wheel up → zoom in (content larger)
- Scroll wheel down → zoom out (content smaller)
- Mouse drag → content pans
- Zoom clamped between 0.25x and 4x
- Zoom centers on cursor position

### Behavior 7: Deterministic colors
- Same region ID → same color every render
- Different region IDs → likely different colors
- Colors are from a colorblind-safe palette

## Implementation Notes

- Scaffold: React app with Vite, D3.js, vitest + React Testing Library
- Component: `<MapRenderer>` in `src/components/MapRenderer.tsx`
- D3 integration via `useRef` (SVG container) + `useEffect` (D3 binds)
- Use `d3-treemap` for layout, `d3-zoom` for pan/zoom behavior
- Tests: use `@testing-library/react` for component rendering, query SVG elements in the DOM
- Layout:
  ```
  src/
    components/
      MapRenderer.tsx       — main component
      MapRenderer.test.tsx  — component tests
      RegionRect.tsx        — individual region rendering
      EdgeOverlay.tsx       — relationship edge rendering
      SkeletonLoader.tsx    — loading state
      EmptyState.tsx        — no data state
    utils/
      color.ts              — deterministic color assignment
      layout.ts             — treemap layout helpers
  ```
