# Spec 09: Web Visualizer — Layer Picker & Overlay Rendering

> GitHub Issue: #9
> Dependencies: Spec #7 (Layer framework, LayerScore), Spec #8 (MapRenderer)
> Status: ready for TDD

## Intent

Enable users to select analysis layers from a sidebar and see them rendered as color-coded overlays on the semantic map, with drill-down into per-module score breakdowns.

## Scope

### In Scope
- **LayerPicker** sidebar component: lists available layers with toggle switches
- **Overlay rendering**: color-coded region fills based on active layer's scores
- **Legend**: color scale with value labels for the active layer
- **LayerDetailPanel**: click a region to see per-module score breakdown
- **Multi-layer state**: last-activated-wins for color precedence
- Active layer state management via React context

### Out of Scope
- Layer blending modes (defer to future — too complex for v1)
- Zoom-level-specific overlay behavior (regions always show region-level scores; modules show module scores when zoomed to detail)
- Creating new layer types (that's Spec #7)
- Touch/mobile interactions

## Component APIs

```typescript
// Layer picker sidebar
interface LayerPickerProps {
  layers: Layer[];                    // from Spec #7's LayerRegistry
  activeLayers: string[];             // ordered list of active layer IDs (most recent last)
  onToggleLayer: (layerId: string) => void;
}

// Overlay data passed to MapRenderer (extends Spec #8's props)
interface MapOverlayProps {
  regionScores?: Map<string, LayerScore>;  // region id → score for active layer
  colorScale?: ColorScale;                  // color mapping for active layer
}

// Detail panel
interface LayerDetailPanelProps {
  regionId: string;
  regionName: string;
  moduleScores: Map<string, LayerScore>;  // module id → score
  layerName: string;
  colorScale: ColorScale;
  onClose: () => void;
}

// Color scale definition (added to Layer interface from Spec #7)
interface ColorScale {
  low: string;        // color for value 0 (e.g., "#d32f2f" red)
  high: string;       // color for value 1 (e.g., "#388e3c" green)
  midpoint?: string;  // optional midpoint color (e.g., "#fbc02d" yellow)
}
```

## Design Decisions

1. **Last-activated-wins**: when multiple layers are active, the most recently toggled layer's colors are displayed. Deactivating it reveals the next-most-recent. Simple stack behavior.
2. **Click interaction**: single-click on a region with active layer → opens LayerDetailPanel. Double-click → zoom in (Spec #8). This uses the 300ms delay already defined in Spec #8 to distinguish.
3. **No active layer → default behavior**: when no layers are active, clicks behave per Spec #8 (select on single-click, zoom on double-click). Detail panel doesn't open.
4. **Detail panel placement**: right sidebar drawer. Slides in from the right. Clicking a different region updates the panel. Close button or click outside to dismiss.
5. **Legend**: displayed below the toggle list in the LayerPicker sidebar. Shows a continuous gradient bar from low to high color with min/max value labels. Only shown when a layer is active.
6. **Colorblind-safe defaults**: each layer defines its own ColorScale. Recommended defaults:
   - Coverage: red (#d32f2f) → green (#388e3c) — standard, with viridis alternative
   - Staleness: blue (#1565c0) → orange (#e65100)
   - Complexity: green (#388e3c) → red (#d32f2f) (inverted — low complexity is good)
7. **Region with no score**: rendered in neutral gray (#9e9e9e) when layer is active.

## Acceptance Criteria

1. LayerPicker renders a list of available layers with toggle switches
2. Toggling a layer ON applies color coding to regions based on LayerScore values
3. Toggling a layer OFF reverts to default colors (or reveals next active layer's colors)
4. Region with score 0.9 on coverage → green; score 0.3 → red
5. With two layers active, most recently activated layer's colors shown
6. Single-click on region with active layer → LayerDetailPanel opens showing per-module scores
7. Double-click on region → zoom in (unchanged from Spec #8, even with active layer)
8. Legend shows color scale gradient and value labels for the active layer
9. Region with no score for active layer → neutral gray
10. No active layers → no overlay, clicks behave per Spec #8 defaults

## Test Plan

### Behavior 1: LayerPicker rendering
- 3 available layers → 3 items with toggle switches
- 0 layers → empty state message
- Toggle state reflects activeLayers prop
- Long layer names → truncated

### Behavior 2: Layer toggle → overlay
- Toggle ON coverage → regions colored by coverage scores
- Score 0.9 → green fill, score 0.3 → red fill, score 0.5 → yellow/midpoint
- Toggle OFF → default colors restored
- Region with no score → gray

### Behavior 3: Multi-layer precedence
- Activate A then B → B's colors shown
- Deactivate B → A's colors shown
- Deactivate A (only remaining) → default colors
- Re-activate A (while B active) → A becomes most recent, A's colors shown

### Behavior 4: Detail panel
- Single-click region with active layer → panel opens
- Panel shows module-by-module scores with colors
- Click different region → panel updates
- Close button → panel closes
- No active layer + click → no panel (falls through to Spec #8 select)

### Behavior 5: Legend
- Active layer → legend visible with gradient bar
- No active layer → no legend
- Switch active layer → legend updates to new layer's scale
- Legend shows min/max labels (e.g., "0%" / "100%" for coverage)

### Behavior 6: Color scale
- Interpolation between low/high colors is smooth
- Midpoint color used when defined (3-stop gradient)
- Score 0 → exactly low color
- Score 1 → exactly high color
- NaN/undefined score → neutral gray fallback

## Implementation Notes

- State management: React context `LayerOverlayContext` holding activeLayers stack, computed scores
- MapRenderer extended with optional `regionScores` and `colorScale` props
- Color interpolation: use `d3-interpolate` for smooth color blending
- Layout:
  ```
  src/
    components/
      LayerPicker.tsx           — sidebar toggle list + legend
      LayerDetailPanel.tsx      — right drawer with per-module scores
      LayerOverlayContext.tsx   — React context for active layer state
    utils/
      colorScale.ts             — color interpolation utilities
  ```
