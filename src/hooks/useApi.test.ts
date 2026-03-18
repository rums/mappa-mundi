import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson, ApiError } from './useApi';

describe('fetchJson', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed JSON on success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchJson<{ id: number; name: string }>('/api/test');
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('passes through RequestInit options to fetch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await fetchJson('/api/test', { method: 'POST', body: '{"a":1}' });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      body: '{"a":1}',
    });
  });

  it('throws ApiError with status and message on non-ok response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not found', code: 'NOT_FOUND' }), {
        status: 404,
        statusText: 'Not Found',
      }),
    );

    await expect(fetchJson('/api/missing')).rejects.toThrow(ApiError);
    try {
      await fetchJson('/api/missing');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const apiErr = e as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(404);
      expect(apiErr.message).toBe('Not found');
      expect(apiErr.code).toBe('NOT_FOUND');
    }
  });

  it('throws ApiError with statusText when body has no message', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(fetchJson('/api/broken')).rejects.toThrow(ApiError);
  });

  it('supports AbortController signal', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.mocked(globalThis.fetch).mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    await expect(
      fetchJson('/api/test', { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('ApiError', () => {
  it('is an instance of Error', () => {
    const err = new ApiError(500, 'Server error');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
  });

  it('exposes status, message, and optional code', () => {
    const err = new ApiError(422, 'Validation failed', 'VALIDATION_ERROR');
    expect(err.status).toBe(422);
    expect(err.message).toBe('Validation failed');
    expect(err.code).toBe('VALIDATION_ERROR');
  });
});
