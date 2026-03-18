import { useState } from 'react';
import type { SemanticZoomLevel } from '../types';

export function useScan() {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'completed' | 'failed'>('idle');
  const [data, setData] = useState<SemanticZoomLevel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async (path: string) => {
    setStatus('scanning');
    setError(null);
  };

  const refresh = async () => {};

  return { scan, refresh, status, data, error };
}
