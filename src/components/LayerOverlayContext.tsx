import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ColorScale } from '../utils/colorScale';
import type { LayerScore } from '../layers/types';

interface LayerOverlayContextValue {
  activeLayers: string[];
  toggleLayer: (id: string) => void;
  activeColorScale: ColorScale | null;
  activeLayerScores: Map<string, LayerScore> | null;
}

const LayerOverlayContext = createContext<LayerOverlayContextValue | null>(null);

export function LayerOverlayProvider({ children }: { children: React.ReactNode }) {
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  const toggleLayer = useCallback((id: string) => {
    setActiveLayers((prev) => {
      if (prev.includes(id)) {
        return prev.filter((l) => l !== id);
      }
      return [...prev, id];
    });
  }, []);

  const activeColorScale: ColorScale | null = activeLayers.length > 0 ? null : null;
  const activeLayerScores: Map<string, LayerScore> | null = activeLayers.length > 0 ? null : null;

  return (
    <LayerOverlayContext.Provider value={{ activeLayers, toggleLayer, activeColorScale, activeLayerScores }}>
      {children}
    </LayerOverlayContext.Provider>
  );
}

export function useLayerOverlay(): LayerOverlayContextValue {
  const ctx = useContext(LayerOverlayContext);
  if (!ctx) {
    throw new Error('useLayerOverlay must be used within a LayerOverlayProvider');
  }
  return ctx;
}
