import type { Layer, LayerScore } from '../layers/types';

export function useLayers() {
  return {
    layers: [] as Layer[],
    activeLayerId: null as string | null,
    activateLayer: (_id: string) => {},
    deactivateLayer: (_id: string) => {},
    scores: null as Map<string, LayerScore> | null,
    scoresLoading: false,
  };
}
