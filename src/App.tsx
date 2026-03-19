import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useScan } from './hooks/useScan';
import { useZoomLevel } from './hooks/useZoomLevel';
import { useLayers } from './hooks/useLayers';
import { useLenses } from './hooks/useLenses';
import { useSearch } from './hooks/useSearch';
import { CirclePackRenderer } from './components/CirclePackRenderer';
import { LayerPicker } from './components/LayerPicker';
import { LayerDetailPanel } from './components/LayerDetailPanel';
import { LensPicker } from './components/LensPicker';
import { Spinner } from './components/Spinner';
import type { ColorScale } from './utils/colorScale';
import type { SemanticZoomLevel } from './types';
import type { LayerScore } from './layers/types';

const DEFAULT_COLOR_SCALE: ColorScale = { low: '#d32f2f', high: '#388e3c' };

interface ZoomEntry {
  regionId: string;
  label: string;
}

interface SavedProject {
  path: string;
  name: string;
  scannedAt: string;
  regionCount: number;
  moduleCount: number;
}

export function App() {
  const [path, setPath] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [zoomStack, setZoomStack] = useState<ZoomEntry[]>([]);
  const [searchDismissed, setSearchDismissed] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [activeCompoundLensId, setActiveCompoundLensId] = useState<string | null>(null);

  const { scan, refresh, status, data: scanData, error, loadDirect } = useScan();
  const { compoundLenses, layerLenses, createLens, deleteLens } = useLenses();

  // Fetch saved projects on mount and after scan completes
  const fetchProjects = useCallback(() => {
    fetch('/api/projects').then(r => r.json()).then(d => setSavedProjects(d.projects || [])).catch(() => {});
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { if (status === 'completed') fetchProjects(); }, [status, fetchProjects]);

  const loadProject = useCallback(async (projectPath: string) => {
    try {
      const res = await fetch('/api/projects/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.zoomLevel) {
        loadDirect(data.zoomLevel);
        setPath(projectPath);
        setZoomStack([]);
        setSelectedRegionId(null);
      }
    } catch {}
  }, [loadDirect]);
  const currentZoomRegionId = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1].regionId : null;
  const { data: zoomData, moduleMap: zoomModuleMap, loading: zoomLoading } = useZoomLevel(currentZoomRegionId);
  const { layers, activeLayerId, activateLayer, deactivateLayer, scores, scoresLoading } = useLayers();
  const { setQuery, results, error: searchError } = useSearch();

  // Determine what data to show
  const isZoomed = zoomStack.length > 0;
  const displayData: SemanticZoomLevel | null = isZoomed ? zoomData : scanData;
  const isLoading = status === 'scanning' || (isZoomed && zoomLoading);

  const handleScan = useCallback(() => {
    if (path.trim()) {
      scan(path, activeCompoundLensId);
    }
  }, [path, scan, activeCompoundLensId]);

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
  // Use the zoom-level module map when available for accurate sub-region matching
  const currentModuleMap = isZoomed ? zoomModuleMap : null;

  const regionScores = useMemo(() => {
    if (!scores || !displayData) return undefined;
    const map = new Map<string, LayerScore>();
    for (const region of displayData.regions) {
      // First: check if scores has a direct region ID key
      if (scores[region.id]) {
        map.set(region.id, scores[region.id] as LayerScore);
        continue;
      }

      // Second: if we have a module map for this zoom level, use it for precise matching
      if (currentModuleMap && currentModuleMap[region.id]) {
        const regionModules = currentModuleMap[region.id];
        const matching = regionModules
          .map((m: string) => scores[m])
          .filter(Boolean) as LayerScore[];
        if (matching.length > 0) {
          const maxScore = matching.reduce((best, s) =>
            s.value > best.value ? s : best, matching[0]);
          map.set(region.id, maxScore);
          continue;
        }
      }

      // Third: fallback path-segment matching
      const prefix = region.id.replace(/^region-/, '').replace(/-files$/, '');
      const matching: LayerScore[] = [];
      for (const [moduleId, score] of Object.entries(scores)) {
        if (moduleId.startsWith('region-') || moduleId.startsWith('module-')) continue;
        const parts = moduleId.split('/');
        if (parts.some(p => p.toLowerCase() === prefix.toLowerCase()) ||
            moduleId.toLowerCase().startsWith(prefix.toLowerCase() + '/') ||
            moduleId.toLowerCase().startsWith(prefix.toLowerCase())) {
          matching.push(score as LayerScore);
        }
      }
      if (matching.length > 0) {
        const maxScore = matching.reduce((best, s) =>
          s.value > best.value ? s : best, matching[0]);
        map.set(region.id, maxScore);
      }
    }
    return map.size > 0 ? map : undefined;
  }, [scores, displayData, currentModuleMap]);

  // Show search results dropdown
  const showSearchDropdown = results.length > 0 && !searchDismissed;
  const visibleResults = results.slice(0, 20);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1a1a2e', color: '#eee', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center', background: '#16213e', borderBottom: '1px solid #0f3460', flexShrink: 0 }}>
        <input
          type="text"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="Enter project path..."
        />
        <button
          onClick={handleScan}
          disabled={!path.trim() || status === 'scanning'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px' }}
        >
          {status === 'scanning' && (
            <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {status === 'scanning' ? 'Scanning...' : 'Scan'}
        </button>

        <LensPicker
          compoundLenses={compoundLenses}
          layerLenses={layerLenses}
          activeCompoundLensId={activeCompoundLensId}
          onSelectCompoundLens={setActiveCompoundLensId}
          onCreateLens={(name, type, prompt) => createLens(name, type, prompt)}
          onDeleteLens={deleteLens}
        />

        {savedProjects.length > 0 && (
          <select
            value=""
            onChange={e => { if (e.target.value) loadProject(e.target.value); }}
            style={{ marginLeft: 8 }}
          >
            <option value="">Load saved...</option>
            {savedProjects.map(p => (
              <option key={p.path} value={p.path}>
                {p.name} ({p.moduleCount} modules, {p.regionCount} regions)
              </option>
            ))}
          </select>
        )}

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
        <nav style={{ padding: '4px 12px', fontSize: 13, color: '#aaa', flexShrink: 0 }}>
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

      {/* Layer error — only show if we tried and failed, not during initial render */}
      {activeLayerId && !scores && !scoresLoading && status === 'completed' && displayData && (
        <div style={{ padding: '4px 12px', color: '#aa6633', fontSize: 12 }}>
          Layer scores could not be computed for this view. Try at a different zoom level.
        </div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Map area */}
        <div style={{ flex: 1, position: 'relative' }}>
          {status === 'idle' && !scanData && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 18 }}>
              Scan a project to begin
            </div>
          )}
          {status === 'scanning' && !displayData && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spinner message="Scanning project and building semantic map..." size={48} />
            </div>
          )}
          {(displayData || (status === 'scanning' && displayData)) && (
            <div aria-hidden="true" style={{ width: '100%', height: '100%', position: 'relative' }}>
              <CirclePackRenderer
                data={displayData}
                loading={false}
                width={Math.max(600, window.innerWidth - 250)}
                height={Math.max(400, window.innerHeight - 80)}
                onZoomIn={handleZoomIn}
                onRegionSelect={handleRegionSelect}
                selectedRegionId={selectedRegionId}
                regionScores={regionScores}
                colorScale={regionScores ? DEFAULT_COLOR_SCALE : undefined}
              />
              {isZoomed && zoomLoading && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(26,26,46,0.7)' }}>
                  <Spinner message="Loading sub-level..." size={40} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 220, padding: '8px 12px', borderLeft: '1px solid #0f3460', overflowY: 'auto', fontSize: 13, flexShrink: 0 }}>
          <LayerPicker
            layers={layers}
            activeLayers={activeLayers}
            onToggleLayer={handleToggleLayer}
            loading={scoresLoading}
          />
          {scoresLoading && (
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
              <Spinner message="Computing layer scores..." size={24} />
            </div>
          )}

          {/* Detail panel — inside sidebar */}
          {showDetailPanel && selectedRegion && activeLayer && scores && (
            <div style={{ marginTop: 16, borderTop: '1px solid #0f3460', paddingTop: 8 }}>
              <LayerDetailPanel
                regionId={selectedRegionId!}
                regionName={selectedRegion.name}
                moduleScores={scores}
                layerName={activeLayer.name}
                colorScale={DEFAULT_COLOR_SCALE}
                onClose={handleCloseDetail}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
