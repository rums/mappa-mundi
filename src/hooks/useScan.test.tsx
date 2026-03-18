import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useScan } from './useScan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSequence(responses: Array<() => Response | Promise<Response>>) {
  const mock = vi.fn();
  for (const respFn of responses) {
    mock.mockImplementationOnce(respFn);
  }
  return mock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useScan', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('starts in idle state with null data and null error', () => {
    const { result } = renderHook(() => useScan());
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('scan() posts to /api/scan with projectPath and transitions to scanning', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ jobId: 'job-1' }),
    );

    const { result } = renderHook(() => useScan());

    await act(async () => {
      result.current.scan('/my/project');
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/scan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectPath: '/my/project' }),
      }),
    );
    expect(result.current.status).toBe('scanning');
  });

  it('polls job status every 1000ms while queued or running', async () => {
    const fetchMock = mockFetchSequence([
      // POST /api/scan
      () => jsonResponse({ jobId: 'job-1' }),
      // GET /api/jobs/job-1 (queued)
      () => jsonResponse({ status: 'queued' }),
      // GET /api/jobs/job-1 (running)
      () => jsonResponse({ status: 'running' }),
      // GET /api/jobs/job-1 (completed)
      () =>
        jsonResponse({
          status: 'completed',
          result: {
            id: 'root',
            label: 'Root',
            regions: [],
            relationships: [],
          },
        }),
    ]);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useScan());

    await act(async () => {
      result.current.scan('/project');
    });

    // Advance through polling intervals
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST + first poll

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // + second poll

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4); // + third poll (completed)
  });

  it('sets data and status=completed when job completes', async () => {
    const zoomLevel = {
      id: 'root',
      label: 'Root Level',
      regions: [{ id: 'r1', name: 'Region 1', moduleCount: 5, loc: 1000 }],
      relationships: [],
    };

    const fetchMock = mockFetchSequence([
      () => jsonResponse({ jobId: 'job-1' }),
      () => jsonResponse({ status: 'completed', result: zoomLevel }),
    ]);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useScan());

    await act(async () => {
      result.current.scan('/project');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe('completed');
    expect(result.current.data).toEqual(zoomLevel);
    expect(result.current.error).toBeNull();
  });

  it('sets error and status=failed when job fails', async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResponse({ jobId: 'job-2' }),
      () =>
        jsonResponse({ status: 'failed', error: 'Could not parse project' }),
    ]);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useScan());

    await act(async () => {
      result.current.scan('/bad/project');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe('Could not parse project');
    expect(result.current.data).toBeNull();
  });

  it('cleans up polling interval on unmount', async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResponse({ jobId: 'job-3' }),
      () => jsonResponse({ status: 'running' }),
      () => jsonResponse({ status: 'running' }),
    ]);
    globalThis.fetch = fetchMock;

    const { result, unmount } = renderHook(() => useScan());

    await act(async () => {
      result.current.scan('/project');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST + 1 poll

    unmount();

    // After unmount, no more polling should happen
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('calling scan() while already scanning cancels previous polling', async () => {
    const fetchMock = vi.fn()
      // First scan
      .mockResolvedValueOnce(jsonResponse({ jobId: 'job-a' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'running' }))
      // Second scan
      .mockResolvedValueOnce(jsonResponse({ jobId: 'job-b' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'completed',
          result: { id: 'root', label: 'Root', regions: [], relationships: [] },
        }),
      );
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useScan());

    // Start first scan
    await act(async () => {
      result.current.scan('/first');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Start second scan (should cancel first)
    await act(async () => {
      result.current.scan('/second');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Should be polling job-b, not job-a
    expect(result.current.status).toBe('completed');
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(lastCall[0]).toContain('job-b');
  });

  it('refresh() posts to /api/refresh and starts polling', async () => {
    const fetchMock = mockFetchSequence([
      // POST /api/scan (initial)
      () => jsonResponse({ jobId: 'job-init' }),
      () =>
        jsonResponse({
          status: 'completed',
          result: { id: 'root', label: 'Root', regions: [], relationships: [] },
        }),
      // POST /api/refresh
      () => jsonResponse({ jobId: 'job-refresh' }),
      () =>
        jsonResponse({
          status: 'completed',
          result: {
            id: 'root',
            label: 'Refreshed',
            regions: [],
            relationships: [],
          },
        }),
    ]);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useScan());

    // Initial scan
    await act(async () => {
      result.current.scan('/project');
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Refresh
    await act(async () => {
      result.current.refresh();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/refresh',
      expect.objectContaining({ method: 'POST' }),
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe('completed');
    expect(result.current.data?.label).toBe('Refreshed');
  });
});
