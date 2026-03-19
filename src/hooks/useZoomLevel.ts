import { useState, useEffect } from 'react';

export function useZoomLevel(regionId: string | null) {
  const [data, setData] = useState<any | null>(null);
  const [moduleMap, setModuleMap] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any | null>(null);

  useEffect(() => {
    if (regionId === null) {
      setData(null);
      setModuleMap(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/zoom/${regionId}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!controller.signal.aborted) {
          setData(json.level);
          setModuleMap(json.regionModuleMap ?? null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err);
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [regionId]);

  return { data, moduleMap, loading, error };
}
