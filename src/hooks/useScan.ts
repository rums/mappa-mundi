import { useState, useCallback, useRef, useEffect } from 'react';

interface ScanState {
  status: 'idle' | 'scanning' | 'completed' | 'failed';
  data: any | null;
  error: string | null;
}

export function useScan() {
  const [state, setState] = useState<ScanState>({
    status: 'idle',
    data: null,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  const startPolling = useCallback((jobId: string) => {
    clearPolling();

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.status === 404) {
          // Job expired or not found — treat as failure
          setState({ status: 'failed', data: null, error: 'Scan job expired. Try again.' });
          clearInterval(id);
          intervalRef.current = null;
          return;
        }
        const data = await res.json();

        if (data.status === 'completed') {
          setState({ status: 'completed', data: data.result, error: null });
          clearInterval(id);
          intervalRef.current = null;
        } else if (data.status === 'failed') {
          setState({ status: 'failed', data: null, error: data.error });
          clearInterval(id);
          intervalRef.current = null;
        }
        // queued or running: continue polling
      } catch {
        // ignore polling errors
      }
    }, 1000);

    intervalRef.current = id;
  }, [clearPolling]);

  const scan = useCallback(async (projectPath: string, compoundLensId?: string | null) => {
    clearPolling();

    const url = compoundLensId
      ? `/api/scan?compoundLensId=${encodeURIComponent(compoundLensId)}`
      : '/api/scan';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState({ status: 'failed', data: null, error: body.error?.message || `HTTP ${res.status}` });
      return;
    }

    const { jobId } = await res.json();
    setState({ status: 'scanning', data: null, error: null });
    startPolling(jobId);
  }, [clearPolling, startPolling]);

  const refresh = useCallback(async () => {
    clearPolling();

    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState({ status: 'failed', data: null, error: body.error?.message || `HTTP ${res.status}` });
      return;
    }

    const { jobId } = await res.json();
    setState((prev) => ({ ...prev, status: 'scanning' }));
    startPolling(jobId);
  }, [clearPolling, startPolling]);

  const loadDirect = useCallback((data: any) => {
    clearPolling();
    setState({ status: 'completed', data, error: null });
  }, [clearPolling]);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    scan,
    refresh,
    loadDirect,
  };
}
