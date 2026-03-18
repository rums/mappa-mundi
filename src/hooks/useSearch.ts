import { useState, useCallback, useRef, useEffect } from 'react';

export function useSearch() {
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A counter that triggers immediate fetch when incremented
  const [fetchTrigger, setFetchTrigger] = useState<{ q: string; id: number } | null>(null);

  useEffect(() => {
    if (fetchTrigger === null) return;

    const q = fetchTrigger.q;

    // Cancel previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const url = `/api/search?q=${encodeURIComponent(q)}&maxResults=20`;
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setResults(json.results);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err);
        setResults([]);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [fetchTrigger]);

  const triggerIdRef = useRef(0);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (q === '') {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      triggerIdRef.current += 1;
      setFetchTrigger({ q, id: triggerIdRef.current });
    }, 300);
  }, []);

  const search = useCallback((q: string) => {
    setQueryState(q);

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    triggerIdRef.current += 1;
    setFetchTrigger({ q, id: triggerIdRef.current });
  }, []);

  return {
    query,
    results,
    loading,
    error,
    setQuery,
    search,
  };
}
