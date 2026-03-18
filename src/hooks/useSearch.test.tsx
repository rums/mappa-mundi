import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearch } from './useSearch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleResults = [
  { id: 'mod-1', name: 'UserService', kind: 'module', score: 0.95 },
  { id: 'sym-1', name: 'fetchUser', kind: 'symbol', score: 0.8, context: 'UserService' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSearch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('starts with empty query, empty results, not loading', () => {
    const { result } = renderHook(() => useSearch());
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('setQuery updates the query state', () => {
    const { result } = renderHook(() => useSearch());

    act(() => {
      result.current.setQuery('user');
    });

    expect(result.current.query).toBe('user');
  });

  it('setQuery debounces search by 300ms', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: sampleResults }),
    );

    const { result } = renderHook(() => useSearch());

    act(() => {
      result.current.setQuery('user');
    });

    // Not yet fetched (debounce not elapsed)
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=user'),
      expect.any(Object),
    );
  });

  it('empty query clears results without fetching', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: sampleResults }),
    );

    const { result } = renderHook(() => useSearch());

    // First search with actual query
    act(() => {
      result.current.setQuery('user');
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Now clear
    const callsBefore = vi.mocked(globalThis.fetch).mock.calls.length;
    act(() => {
      result.current.setQuery('');
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toEqual([]);
    // No additional fetch calls
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsBefore);
  });

  it('search() fetches immediately bypassing debounce', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: sampleResults }),
    );

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      result.current.search('immediate');
    });

    // Should have fetched immediately, no need to advance timers
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=immediate'),
      expect.any(Object),
    );
  });

  it('search() includes maxResults=20 parameter', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: [] }),
    );

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      result.current.search('test');
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('maxResults=20'),
      expect.any(Object),
    );
  });

  it('populates results on successful search', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: sampleResults }),
    );

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      result.current.search('user');
    });

    await waitFor(() => {
      expect(result.current.results).toEqual(sampleResults);
    });
    expect(result.current.loading).toBe(false);
  });

  it('sets error on fetch failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'Search failed' }, 500),
    );

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      result.current.search('broken');
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    expect(result.current.results).toEqual([]);
  });

  it('cancels previous in-flight request on new search', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    let resolveFirst: (v: Response) => void;
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(
        () => new Promise((r) => { resolveFirst = r; }),
      )
      .mockResolvedValueOnce(jsonResponse({ results: sampleResults }));

    const { result } = renderHook(() => useSearch());

    // Start first search
    act(() => {
      result.current.search('first');
    });

    // Start second search before first completes
    await act(async () => {
      result.current.search('second');
    });

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('encodes query parameter in URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: [] }),
    );

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      result.current.search('hello world');
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=hello%20world'),
      expect.any(Object),
    );
  });

  it('debounced setQuery resets timer on rapid input', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ results: sampleResults }),
    );

    const { result } = renderHook(() => useSearch());

    act(() => {
      result.current.setQuery('u');
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current.setQuery('us');
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      result.current.setQuery('user');
    });

    // Only 200ms since last setQuery, should not have fetched yet
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Advance past debounce from last setQuery
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Now should have fetched with final query
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=user'),
      expect.any(Object),
    );
  });
});
