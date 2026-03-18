import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useZoomLevel } from './useZoomLevel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleLevel = {
  id: 'sub-1',
  label: 'Sub Region',
  regions: [{ id: 'r1', name: 'Child', moduleCount: 3, loc: 500 }],
  relationships: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useZoomLevel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null data, loading=false, error=null when regionId is null', () => {
    const { result } = renderHook(() => useZoomLevel(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when regionId is null', () => {
    renderHook(() => useZoomLevel(null));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fetches zoom level when regionId is provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ level: sampleLevel }),
    );

    const { result } = renderHook(() => useZoomLevel('region-a'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/zoom/region-a',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toEqual(sampleLevel);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true while fetching', async () => {
    let resolvePromise: (v: Response) => void;
    vi.mocked(globalThis.fetch).mockReturnValue(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );

    const { result } = renderHook(() => useZoomLevel('region-a'));

    // Should be loading
    expect(result.current.loading).toBe(true);

    // Resolve the fetch
    await act(async () => {
      resolvePromise!(jsonResponse({ level: sampleLevel }));
    });

    expect(result.current.loading).toBe(false);
  });

  it('sets error on fetch failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'Region not found' }, 404),
    );

    const { result } = renderHook(() => useZoomLevel('bad-region'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it('updates data when regionId changes', async () => {
    const secondLevel = {
      id: 'sub-2',
      label: 'Other Sub',
      regions: [],
      relationships: [],
    };

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ level: sampleLevel }))
      .mockResolvedValueOnce(jsonResponse({ level: secondLevel }));

    const { result, rerender } = renderHook(
      ({ regionId }: { regionId: string | null }) => useZoomLevel(regionId),
      { initialProps: { regionId: 'region-a' } },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleLevel);
    });

    rerender({ regionId: 'region-b' });

    await waitFor(() => {
      expect(result.current.data).toEqual(secondLevel);
    });
  });

  it('cancels in-flight request when regionId changes', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    let resolveFirst: (v: Response) => void;
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(
        () => new Promise((r) => { resolveFirst = r; }),
      )
      .mockResolvedValueOnce(jsonResponse({ level: sampleLevel }));

    const { result, rerender } = renderHook(
      ({ regionId }: { regionId: string | null }) => useZoomLevel(regionId),
      { initialProps: { regionId: 'region-a' } },
    );

    // Change regionId before first request completes
    rerender({ regionId: 'region-b' });

    expect(abortSpy).toHaveBeenCalled();

    abortSpy.mockRestore();
  });

  it('resets to null data when regionId changes to null', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ level: sampleLevel }),
    );

    const { result, rerender } = renderHook(
      ({ regionId }: { regionId: string | null }) => useZoomLevel(regionId),
      { initialProps: { regionId: 'region-a' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(sampleLevel);
    });

    rerender({ regionId: null });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
