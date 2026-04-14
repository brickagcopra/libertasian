import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// We need to test the ApiClient class itself, so import fresh each time
// and mock the global fetch.

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import so the module picks up mocked fetch
const { apiClient, ApiClientError } = await import('./api-client');

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes GET requests to the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
    });

    const result = await apiClient.get('/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/test');
    expect(options.method).toBe('GET');
    expect(result).toEqual({ data: 'test' });
  });

  it('makes POST requests with JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.post('/auth/login', { email: 'a@b.com', password: '123' });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ email: 'a@b.com', password: '123' }));
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('injects auth token when configured', async () => {
    apiClient.configure({
      getAccessToken: () => 'my-token-123',
      onUnauthorized: vi.fn(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await apiClient.get('/protected');

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token-123');

    // Clean up
    apiClient.configure({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });
  });

  it('calls onUnauthorized and throws on 401', async () => {
    const onUnauthorized = vi.fn();
    apiClient.configure({
      getAccessToken: () => null,
      onUnauthorized,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    await expect(apiClient.get('/protected')).rejects.toThrow(ApiClientError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('throws ApiClientError with status code on non-ok responses', async () => {
    apiClient.configure({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    });

    try {
      await apiClient.get('/missing');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).statusCode).toBe(404);
      expect((error as ApiClientError).message).toBe('Not found');
    }
  });

  it('appends query params to URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    await apiClient.get('/search', { params: { q: 'test', limit: '10' } });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
  });

  describe('concurrent 401 deduplication', () => {
    it('fires only one refresh when multiple 401s arrive concurrently', async () => {
      const refreshFn = vi.fn().mockResolvedValue('new-token-abc');
      apiClient.configure({
        getAccessToken: () => 'expired-token',
        onUnauthorized: vi.fn(),
        refreshAccessToken: refreshFn,
      });

      // All 3 initial requests return 401
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Expired' }) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Expired' }) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Expired' }) })
        // All 3 retries succeed
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: 'a' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: 'b' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: 'c' }) });

      const [r1, r2, r3] = await Promise.all([
        apiClient.get('/a'),
        apiClient.get('/b'),
        apiClient.get('/c'),
      ]);

      expect(r1).toEqual({ data: 'a' });
      expect(r2).toEqual({ data: 'b' });
      expect(r3).toEqual({ data: 'c' });
      // refreshAccessToken should only be called once (deduplicated)
      expect(refreshFn).toHaveBeenCalledTimes(1);
      // 3 initial + 3 retries = 6 fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(6);

      // Clean up
      apiClient.configure({
        getAccessToken: () => null,
        onUnauthorized: vi.fn(),
        refreshAccessToken: vi.fn(),
      });
    });

    it('deduplicates apiClient.refresh() when called concurrently', async () => {
      const refreshFn = vi.fn().mockResolvedValue('new-token-dedup');
      apiClient.configure({
        getAccessToken: () => null,
        onUnauthorized: vi.fn(),
        refreshAccessToken: refreshFn,
      });

      const [t1, t2] = await Promise.all([
        apiClient.refresh(),
        apiClient.refresh(),
      ]);

      expect(t1).toBe('new-token-dedup');
      expect(t2).toBe('new-token-dedup');
      expect(refreshFn).toHaveBeenCalledTimes(1);

      // Clean up
      apiClient.configure({
        getAccessToken: () => null,
        onUnauthorized: vi.fn(),
        refreshAccessToken: vi.fn(),
      });
    });

    it('deduplicates apiClient.refresh() with concurrent 401 interceptor', async () => {
      let resolveRefresh: (value: string) => void;
      const refreshPromise = new Promise<string>((resolve) => {
        resolveRefresh = resolve;
      });
      const refreshFn = vi.fn().mockReturnValue(refreshPromise);

      apiClient.configure({
        getAccessToken: () => 'expired',
        onUnauthorized: vi.fn(),
        refreshAccessToken: refreshFn,
      });

      // Initial request returns 401 — triggers interceptor refresh
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Expired' }),
      });
      // Retry after refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });

      // Start a 401-triggered refresh via apiClient.get()
      const getPromise = apiClient.get('/test');

      // While that refresh is in-flight, call apiClient.refresh() directly
      const directRefreshPromise = apiClient.refresh();

      // Resolve the shared refresh
      resolveRefresh!('shared-token');

      const [getResult, directToken] = await Promise.all([getPromise, directRefreshPromise]);

      expect(getResult).toEqual({ data: 'ok' });
      expect(directToken).toBe('shared-token');
      // Only one refresh call despite two code paths
      expect(refreshFn).toHaveBeenCalledTimes(1);

      // Clean up
      apiClient.configure({
        getAccessToken: () => null,
        onUnauthorized: vi.fn(),
        refreshAccessToken: vi.fn(),
      });
    });
  });
});
