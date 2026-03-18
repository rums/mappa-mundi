import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLayers } from './useLayers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleLayers = [
  { id: 'coverage', name: 'Coverage', description: 'Test coverage overlay' },
  { id: 'complexity', name: 'Complexity', description: 'Code complexity overlay' },
];

const sampleScores = {
  'module-a': { value: 0.85, raw: 85, label: '85%', severity: 'info' },
  'module-b': { value: 0.42, raw: 42, label: '42%', severity: 'warning' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLayers', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches layer list on mount', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ layers: sampleLayers }),
    );

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers).toEqual(sampleLayers);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/layers',
      expect.any(Object),
    );
  });

  it('starts with no active layer and null scores', () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ layers: sampleLayers }),
    );

    const { result } = renderHook(() => useLayers());

    expect(result.current.activeLayerId).toBeNull();
    expect(result.current.scores).toBeNull();
    expect(result.current.scoresLoading).toBe(false);
  });

  it('activateLayer sets activeLayerId and fetches scores', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ layers: sampleLayers }))
      .mockResolvedValueOnce(jsonResponse({ scores: sampleScores }));

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers.length).toBeGreaterThan(0);
    });

    await act(async () => {
      result.current.activateLayer('coverage');
    });

    await waitFor(() => {
      expect(result.current.scoresLoading).toBe(false);
    });

    expect(result.current.activeLayerId).toBe('coverage');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/layers/coverage',
      expect.any(Object),
    );
    expect(result.current.scores).toBeTruthy();
  });

  it('sets scoresLoading=true while fetching scores', async () => {
    let resolveScores: (v: Response) => void;
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ layers: sampleLayers }))
      .mockImplementationOnce(
        () => new Promise((r) => { resolveScores = r; }),
      );

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.activateLayer('coverage');
    });

    expect(result.current.scoresLoading).toBe(true);

    await act(async () => {
      resolveScores!(jsonResponse({ scores: sampleScores }));
    });

    expect(result.current.scoresLoading).toBe(false);
  });

  it('deactivateLayer clears activeLayerId and scores', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ layers: sampleLayers }))
      .mockResolvedValueOnce(jsonResponse({ scores: sampleScores }));

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers.length).toBeGreaterThan(0);
    });

    await act(async () => {
      result.current.activateLayer('coverage');
    });

    await waitFor(() => {
      expect(result.current.scores).toBeTruthy();
    });

    act(() => {
      result.current.deactivateLayer();
    });

    expect(result.current.activeLayerId).toBeNull();
    expect(result.current.scores).toBeNull();
  });

  it('handles fetch error for layer list', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'Server error' }, 500),
    );

    const { result } = renderHook(() => useLayers());

    // Should not crash, layers should be empty
    await waitFor(() => {
      expect(result.current.layers).toEqual([]);
    });
  });

  it('handles fetch error for layer scores', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ layers: sampleLayers }))
      .mockResolvedValueOnce(
        jsonResponse({ message: 'Layer not found' }, 404),
      );

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers.length).toBeGreaterThan(0);
    });

    await act(async () => {
      result.current.activateLayer('nonexistent');
    });

    await waitFor(() => {
      expect(result.current.scoresLoading).toBe(false);
    });

    expect(result.current.scores).toBeNull();
  });

  it('cancels in-flight score request when layer changes', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    let resolveFirst: (v: Response) => void;
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ layers: sampleLayers }))
      .mockImplementationOnce(
        () => new Promise((r) => { resolveFirst = r; }),
      )
      .mockResolvedValueOnce(jsonResponse({ scores: sampleScores }));

    const { result } = renderHook(() => useLayers());

    await waitFor(() => {
      expect(result.current.layers.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.activateLayer('coverage');
    });

    // Activate a different layer before first completes
    await act(async () => {
      result.current.activateLayer('complexity');
    });

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});
