import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useScan } from './hooks/useScan';
import { useZoomLevel } from './hooks/useZoomLevel';
import { useLayers } from './hooks/useLayers';
import { useSearch } from './hooks/useSearch';
import { MapRenderer } from './components/MapRenderer';
import { LayerPicker } from './components/LayerPicker';
import { LayerDetailPanel } from './components/LayerDetailPanel';
import type { ColorScale } from './utils/colorScale';
import type { SemanticZoomLevel } from './types';
import type { LayerScore } from './layers/types';

const DEFAULT_COLOR_SCALE: ColorScale = { low: '#d32f2f', high: '#388e3c' };

interface ZoomEntry {
  regionId: string;
  label: string;
}

export function App() {
  const [path, setPath] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [zoomStack, setZoomStack] = useState<ZoomEntry[]>([]);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const { scan, refresh, status, data: scanData, error } = useScan();
  const currentZoomRegionId = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1].regionId : null;
  const { data: zoomData, loading: zoomLoading } = useZoomLevel(currentZoomRegionId);
  const { layers, activeLayerId, activateLayer, deactivateLayer, scores, scoresLoading } = useLayers();
  const { setQuery, results, error: searchError } = useSearch();

  // Determine what data to show
  const isZoomed = zoomStack.length > 0;
  const displayData: SemanticZoomLevel | null = isZoomed ? zoomData : scanData;
  const isLoading = status === 'scanning' || (isZoomed && zoomLoading);

  const handleScan = useCallback(() => {
    if (path.trim()) {
      scan(path);
    }
  }, [path, scan]);

  const handleRegionSelect = useCallback((regionId: string) => {
    setSelectedRegionId(regionId);
  }, []);

  const handleZoomIn = useCallback((regionId: string) => {
    // Find region label from current display data
    let label = regionId;
    if (displayData) {
      const region = displayData.regions.find(r => r.id === regionId);
      if (region) label = region.name;
    }
    setZoomStack(prev => [...prev, { regionId, label }]);
    setSelectedRegionId(null);
  }, [displayData]);

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index < 0) {
      // Click on Root
      setZoomStack([]);
      setSelectedRegionId(null);
    } else {
      setZoomStack(prev => prev.slice(0, index + 1));
      setSelectedRegionId(null);
    }
  }, []);

  const handleToggleLayer = useCallback((id: string) => {
    if (activeLayerId === id) {
      deactivateLayer(id);
    } else {
      activateLayer(id);
    }
  }, [activeLayerId, activateLayer, deactivateLayer]);

  const handleCloseDetail = useCallback(() => {
    setSelectedRegionId(null);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSearchDismissed(false);
  }, [setQuery]);

  const handleSearchResultClick = useCallback((result: { context?: string }) => {
    if (result.context) {
      setSelectedRegionId(result.context);
    }
    setSearchDismissed(true);
  }, []);

  // Close dropdown on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchDismissed(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDismissed(true);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Get selected region info for detail panel
  const selectedRegion = displayData?.regions.find(r => r.id === selectedRegionId) || null;
  const activeLayer = layers.find(l => l.id === activeLayerId);
  const showDetailPanel = selectedRegionId !== null && activeLayerId !== null && scores !== null && selectedRegion !== null;

  const activeLayers = activeLayerId ? [activeLayerId] : [];

  // Aggregate module scores to region scores for the map overlay
  const regionScores = useMemo(() => {
    if (!scores || !displayData) return undefined;
    const map = new Map<string, LayerScore>();
    for (const region of displayData.regions) {
      // Region IDs are like "region-src", "region-api", "module-foo"
      // Module IDs are like "src/scanner.ts", "src/api/server.ts"
      const prefix = region.id.replace(/^region-/, '').replace(/-files$/, '');
      const matching: LayerScore[] = [];
      for (const [moduleId, score] of Object.entries(scores)) {
        const parts = moduleId.split('/');
        // Check if any path segment matches the region name
        if (parts.some(p => p.toLowerCase() === prefix.toLowerCase()) ||
            moduleId.toLowerCase().startsWith(prefix.toLowerCase() + '/') ||
            moduleId.toLowerCase().startsWith(prefix.toLowerCase())) {
          matching.push(score as LayerScore);
        }
      }
      if (matching.length > 0) {
        // Aggregate: use max value and worst severity
        const maxScore = matching.reduce((best, s) =>
          s.value > best.value ? s : best, matching[0]);
        map.set(region.id, maxScore);
      }
    }
    return map.size > 0 ? map : undefined;
  }, [scores, displayData]);

  // Show search results dropdown
  const showSearchDropdown = results.length > 0 && !searchDismissed;
  const visibleResults = results.slice(0, 20);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="Enter project path..."
        />
        <button onClick={handleScan} disabled={!path.trim()}>
          Scan
        </button>

        {/* Search */}
        <div ref={searchRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <input
            type="search"
            placeholder="Search..."
            onChange={handleSearchChange}
          />
          {searchError && <div>Search unavailable</div>}
          {showSearchDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #ccc', zIndex: 10, width: 300 }}>
              {visibleResults.map(result => (
                <div
                  key={result.id}
                  data-search-result
                  style={{ padding: 4, cursor: 'pointer' }}
                  onClick={() => handleSearchResultClick(result)}
                >
                  <span>{result.name}</span>
                  <span data-kind={result.kind} style={{ marginLeft: 8, fontSize: 12, background: '#eee', padding: '0 4px', borderRadius: 4 }}>
                    {result.kind}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      {status === 'completed' && (
        <nav style={{ padding: '0 8px' }}>
          {zoomStack.length > 0 ? (
            <span
              data-breadcrumb
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => handleBreadcrumbClick(-1)}
            >
              Root
            </span>
          ) : (
            <span data-breadcrumb>Root</span>
          )}
          {zoomStack.map((entry, i) => (
            <span key={i}>
              {' > '}
              <span data-breadcrumb>
                {entry.label}
              </span>
            </span>
          ))}
        </nav>
      )}

      {/* Error states */}
      {status === 'failed' && error && (
        <div>
          {error === 'Failed to fetch' ? (
            <div>Cannot connect to API server. Please start the server.</div>
          ) : (
            <div>{error}</div>
          )}
          <button onClick={() => scan(path)}>Retry</button>
        </div>
      )}

      {/* Layer error */}
      {activeLayerId && !scores && !scoresLoading && (
        <div>Layer scores unavailable</div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex' }}>
        {/* Map area */}
        <div style={{ flex: 1 }}>
          {status === 'idle' && !scanData && (
            <div>Scan a project to begin</div>
          )}
          {(status === 'scanning' || status === 'completed' || isZoomed) && (
            <div aria-hidden="true">
              <MapRenderer
                data={isLoading ? null : displayData}
                loading={isLoading}
                onZoomIn={handleZoomIn}
                onRegionSelect={handleRegionSelect}
                selectedRegionId={selectedRegionId}
                regionScores={regionScores}
                colorScale={regionScores ? DEFAULT_COLOR_SCALE : undefined}
              />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 250 }}>
          <LayerPicker
            layers={layers}
            activeLayers={activeLayers}
            onToggleLayer={handleToggleLayer}
          />
        </div>

        {/* Detail panel */}
        {showDetailPanel && selectedRegion && activeLayer && scores && (
          <LayerDetailPanel
            regionId={selectedRegionId!}
            regionName={selectedRegion.name}
            moduleScores={scores}
            layerName={activeLayer.name}
            colorScale={DEFAULT_COLOR_SCALE}
            onClose={handleCloseDetail}
          />
        )}
      </div>
    </div>
  );
}
