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
});
