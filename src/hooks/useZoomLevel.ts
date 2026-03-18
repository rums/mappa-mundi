import type { SemanticZoomLevel } from '../types';

export function useZoomLevel(_regionId: string | null): {
  data: SemanticZoomLevel | null;
  loading: boolean;
  error: string | null;
} {
  return { data: null, loading: false, error: null };
}
