# Spec 15: Integrated App View — Wire Components with Hooks

> GitHub Issue: #38
> Dependencies: Spec #12 (API Entry Point), Spec #13 (App Shell), Spec #14 (Client Hooks)
> Status: ready for TDD

## Intent

Connect MapRenderer, LayerPicker, LayerDetailPanel, and search into a working application by wiring the client hooks into the App shell. This is the final integration spec that makes the app usable end-to-end.

## Scope

### In Scope
- Wiring hooks into App.tsx
- Map rendering with scan data
- Region selection and zoom navigation
- Layer overlay integration
- Search bar with results dropdown
- Breadcrumb navigation for zoom levels
- Error display

### Out of Scope
- New visual components (use existing MapRenderer, LayerPicker, LayerDetailPanel)
- Persistence (refresh = rescan)
- URL routing (single-page, no deep linking)
- Keyboard shortcuts
- Accessibility (defer to follow-up)

## Integration Points

### Scan → Map

```
App.tsx
  └─ useScan() hook
       │
       ├─ scan button onClick → scan(projectPath)
       ├─ status → loading indicator
       ├─ data → passed to MapRenderer as `data` prop
       └─ error → shown in error banner
```

- When `status === 'scanning'`: render `<MapRenderer loading={true} />`
- When `status === 'completed'`: render `<MapRenderer data={data} />`
- When `status === 'failed'`: show error message above map area

### Region Selection

```
MapRenderer onRegionSelect → setSelectedRegionId(id)
  └─ If layer active → show LayerDetailPanel for that region
  └─ Visual highlight on map (MapRenderer handles this internally)
```

State: `selectedRegionId: string | null`

### Zoom Navigation

```
MapRenderer onZoomIn(regionId)
  └─ Push regionId onto zoomStack
  └─ useZoomLevel(regionId) → fetch sub-level
  └─ Render MapRenderer with sub-level data

Breadcrumbs: [Root, ...zoomStack]
  └─ Click breadcrumb → pop stack to that level
  └─ Root click → back to top-level scan data
```

State:
```typescript
zoomStack: Array<{ regionId: string; label: string }>
// Current view = zoomStack.length === 0 ? scanData : zoomLevelData
```

**Breadcrumb component** (inline, no separate file needed):
```
Root > src > components > [current]
```
- Each segment is clickable except the last
- Clicking pops the stack to that depth

### Layer Sidebar

```
Sidebar
  ├─ LayerPicker
  │    └─ layers from useLayers()
  │    └─ onToggleLayer → activateLayer/deactivateLayer
  │
  └─ LayerDetailPanel (conditional)
       └─ Shown when: layer active AND region selected
       └─ moduleScores filtered to selected region
       └─ onClose → deselect region
```

Wire `useLayers()` into MapRenderer:
- `regionScores` prop ← `scores` from hook (aggregated to regions)
- `colorScale` prop ← from active layer or default

### Search Integration

```
Header
  └─ Search input
       └─ useSearch().setQuery on input change
       └─ Results dropdown below input
            └─ Each result: name, kind badge, score
            └─ Click result → find region containing it → select + scroll to region
       └─ Escape → close dropdown
       └─ Click outside → close dropdown
```

**Search results dropdown:**
- Positioned absolutely below the search input
- Shows up to 20 results
- Each result shows: icon/badge for kind (module/symbol/region), name, optional context
- Click → close dropdown, select the matching region on the map

### Error Handling

- API unreachable: show banner "Cannot connect to API server. Run `npm run start:api` to start it."
- Scan failure: show error message with retry button
- Layer fetch failure: show toast/inline error, deactivate layer
- Search failure: show "Search unavailable" in dropdown

## Component Tree

```
<App>
  <header>
    <h1>Mappa Mundi</h1>
    <SearchBar />           // input + results dropdown
    <ScanControls />        // path input + scan button + status
  </header>
  <main>
    <div className="map-container">
      <Breadcrumbs />       // zoom navigation
      <MapRenderer />       // main visualization
    </div>
    <aside className="sidebar">
      <LayerPicker />
      {selectedRegion && activeLayer && (
        <LayerDetailPanel />
      )}
    </aside>
  </main>
</App>
```

Note: SearchBar, ScanControls, and Breadcrumbs can be defined inline in App.tsx or as small components in the same file. They're thin wrappers, not reusable components.

## Test Strategy

### Integration tests (`src/App.test.tsx` — extend existing)
- Scanning: enter path → click scan → shows loading → shows map (mock API)
- Scan error: API returns error → shows error message
- Region select: click region → selectedRegionId updates
- Zoom in: double-click region → breadcrumbs appear → sub-level renders
- Zoom out: click breadcrumb → returns to parent level
- Layer toggle: activate layer → map shows colored regions
- Layer + select: activate layer + select region → detail panel appears
- Search: type query → results appear → click result → region selected
- Search dismiss: press Escape → dropdown closes

### Smoke test (manual, not automated)
- `npm run dev:full` → scan a real project → navigate the map

## Acceptance Criteria
- User can scan a project path and see a treemap visualization
- Single-click selects a region (visual highlight)
- Double-click zooms into a region (fetches sub-level)
- Breadcrumbs show zoom path; clicking navigates back
- Toggling a layer colors regions by score
- Selecting a region with active layer shows detail panel with module scores
- Search input finds and highlights regions
- All error states show user-friendly messages
- No console errors in normal operation
