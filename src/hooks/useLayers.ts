import { useState, useEffect, useCallback, useRef } from 'react';

export function useLayers() {
  const [layers, setLayers] = useState<any[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [scores, setScores] = useState<any | null>(null);
  const [scoresLoading, setScoresLoading] = useState(false);
  const scoresAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/layers', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!controller.signal.aborted) {
          setLayers(json.layers);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLayers([]);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const activateLayer = useCallback(async (id: string) => {
    // Cancel any in-flight score request
    if (scoresAbortRef.current) {
      scoresAbortRef.current.abort();
    }

    const controller = new AbortController();
    scoresAbortRef.current = controller;

    setActiveLayerId(id);
    setScoresLoading(true);

    try {
      const res = await fetch(`/api/layers/${id}`, { signal: controller.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!controller.signal.aborted) {
        setScores(json.moduleScores);
        setScoresLoading(false);
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.log('[useLayers] Layer fetch failed:', err?.message || err);
        setScores(null);
        setScoresLoading(false);
      }
    }
  }, []);

  const deactivateLayer = useCallback(() => {
    if (scoresAbortRef.current) {
      scoresAbortRef.current.abort();
      scoresAbortRef.current = null;
    }
    setActiveLayerId(null);
    setScores(null);
  }, []);

  return {
    layers,
    activeLayerId,
    scores,
    scoresLoading,
    activateLayer,
    deactivateLayer,
  };
}
