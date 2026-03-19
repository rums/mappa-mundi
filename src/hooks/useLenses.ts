import { useState, useEffect, useCallback } from 'react';
import type { Lens, LensType } from '../lenses/types.js';

export function useLenses() {
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLenses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/lenses');
      if (!res.ok) throw new Error('Failed to fetch lenses');
      const data = await res.json();
      setLenses(data.lenses || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load lenses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLenses();
  }, [fetchLenses]);

  const createLens = useCallback(async (name: string, type: LensType, prompt: string): Promise<Lens | null> => {
    try {
      const res = await fetch('/api/lenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, prompt }),
      });
      if (!res.ok) throw new Error('Failed to create lens');
      const data = await res.json();
      await fetchLenses(); // Refresh list
      return data.lens;
    } catch {
      return null;
    }
  }, [fetchLenses]);

  const deleteLens = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/lenses/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      await fetchLenses(); // Refresh list
      return true;
    } catch {
      return false;
    }
  }, [fetchLenses]);

  const compoundLenses = lenses.filter(l => l.type === 'compound');
  const layerLenses = lenses.filter(l => l.type === 'layer');

  return {
    lenses,
    compoundLenses,
    layerLenses,
    loading,
    error,
    createLens,
    deleteLens,
    refresh: fetchLenses,
  };
}
