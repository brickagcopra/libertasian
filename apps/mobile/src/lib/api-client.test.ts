import { ApiClientError, NOT_INCLUDED_MESSAGE } from './api-client';

// We need to mock dependencies before importing the module
const mockGetAccessToken = jest.fn();
const mockGetRefreshToken = jest.fn();
const mockSetAccessToken = jest.fn();
const mockSetRefreshToken = jest.fn();

jest.mock('../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: () => mockGetAccessToken(),
    getRefreshToken: () => mockGetRefreshToken(),
    setAccessToken: (t: string) => mockSetAccessToken(t),
    setRefreshToken: (t: string) => mockSetRefreshToken(t),
  },
}));

// expo-constants is mocked in test/setup.ts with apiUrl: 'http://localhost:3001/api/v1'

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks
import { apiClient } from './api-client';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAccessToken.mockResolvedValue('access-token-123');
  mockGetRefreshToken.mockResolvedValue('refresh-token-456');
});

describe('ApiClientError', () => {
  it('has correct properties', () => {
    const err = new ApiClientError(401, 'Unauthorized');
    expect(err.statusCode).toBe(401);
    expect(err.serverMessage).toBe('Unauthorized');
    expect(err.name).toBe('ApiClientError');
    expect(err.message).toBe('Unauthorized');
  });

  it('is an instance of Error', () => {
    const err = new ApiClientError(500, 'Server error');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('apiClient.get', () => {
  it('makes GET request with auth header and X-Client: mobile', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    const result = await apiClient.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/test',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Client': 'mobile',
        }),
      }),
    );
    // Envelope is stripped at the transport layer.
    expect(result).toEqual([]);
  });

  it('appends query params to URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.get('/search', { params: { q: 'test', limit: '10' } });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('q=test'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.any(Object),
    );
  });

  it('skips auth header when skipAuth is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.get('/public', { skipAuth: true });

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBeUndefined();
  });
});

describe('apiClient.post', () => {
  it('sends JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.post('/items', { name: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/items',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"test"}',
      }),
    );
  });

  it('handles POST without body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.post('/action');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
  });
});

describe('apiClient.patch', () => {
  it('sends PATCH request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.patch('/items/1', { name: 'updated' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('apiClient.delete', () => {
  it('sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.delete('/items/1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('apiClient - 204 No Content', () => {
  it('returns undefined for 204 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await apiClient.delete('/items/1');
    expect(result).toBeUndefined();
  });
});

describe('apiClient - error handling', () => {
  it('throws ApiClientError for non-OK responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Validation failed' }),
    });

    await expect(apiClient.get('/bad')).rejects.toThrow(ApiClientError);
    await expect(apiClient.get('/bad')).rejects.toThrow();
  });

  it('includes status code in thrown error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'Conflict' }),
    });

    try {
      await apiClient.get('/conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).statusCode).toBe(409);
      expect((err as ApiClientError).serverMessage).toBe('Conflict');
    }
  });

  // App Review 2.1(b): a dozen screens render `error.message` raw, so the
  // server body for an entitlement refusal — which can name a tier — is
  // discarded here rather than at each call site.
  it.each([402, 403])(
    'replaces the server message on %i with the neutral not-included string',
    async (status) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        json: () =>
          Promise.resolve({
            message: 'This feature requires a pro subscription or higher.',
          }),
      });

      try {
        await apiClient.get('/gated');
        throw new Error('expected a rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(status);
        expect((err as ApiClientError).message).toBe(NOT_INCLUDED_MESSAGE);
        expect((err as ApiClientError).serverMessage).toBe(NOT_INCLUDED_MESSAGE);
        expect(NOT_INCLUDED_MESSAGE).not.toMatch(/pro|edu|team|enterprise|₱/i);
      }
    },
  );

  it('handles non-JSON error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('Not JSON')),
    });

    try {
      await apiClient.get('/bad-gateway');
    } catch (err) {
      expect((err as ApiClientError).statusCode).toBe(502);
    }
  });
});

describe('apiClient - token refresh on 401', () => {
  it('refreshes token and retries on 401', async () => {
    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Token expired' }),
    });

    // Refresh call succeeds (mobile envelope: tokens in `data`)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          },
        }),
    });

    // Retry call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: 'retried' }),
    });

    const result = await apiClient.get('/protected');

    // Envelope is stripped at the transport layer.
    expect(result).toEqual('retried');
    expect(mockSetAccessToken).toHaveBeenCalledWith('new-access-token');
    expect(mockSetRefreshToken).toHaveBeenCalledWith('new-refresh-token');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('calls onUnauthorized when refresh fails', async () => {
    const onUnauthorized = jest.fn();
    apiClient.setOnUnauthorized(onUnauthorized);

    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Expired' }),
    });

    // Refresh call fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid refresh token' }),
    });

    await expect(apiClient.get('/protected')).rejects.toThrow(
      'Session expired. Please sign in again.',
    );
    expect(onUnauthorized).toHaveBeenCalled();

    // Cleanup
    apiClient.setOnUnauthorized(null as unknown as () => void);
  });

  it('calls onUnauthorized when no refresh token', async () => {
    const onUnauthorized = jest.fn();
    apiClient.setOnUnauthorized(onUnauthorized);
    mockGetRefreshToken.mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Expired' }),
    });

    await expect(apiClient.get('/protected')).rejects.toThrow(
      'Session expired',
    );
    expect(onUnauthorized).toHaveBeenCalled();

    apiClient.setOnUnauthorized(null as unknown as () => void);
  });

  it('skipSignOutOn401: still refreshes, but a persistent 401 throws WITHOUT firing onUnauthorized', async () => {
    const onUnauthorized = jest.fn();
    apiClient.setOnUnauthorized(onUnauthorized);

    // First call: 401 (e.g. wrong current password on /auth/change-password)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    // Refresh call succeeds — the session itself is fine
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          },
        }),
    });

    // Retry still 401 — domain-level rejection, not an expired session
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    await expect(
      apiClient.post('/auth/change-password', { currentPassword: 'x', newPassword: 'y' }, {
        skipSignOutOn401: true,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    apiClient.setOnUnauthorized(null as unknown as () => void);
  });

  it('skipSignOutOn401: does not fire onUnauthorized even when refresh fails', async () => {
    const onUnauthorized = jest.fn();
    apiClient.setOnUnauthorized(onUnauthorized);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid refresh token' }),
    });

    await expect(
      apiClient.post('/auth/mfa/verify', { code: '000000' }, { skipSignOutOn401: true }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(onUnauthorized).not.toHaveBeenCalled();

    apiClient.setOnUnauthorized(null as unknown as () => void);
  });

  it('does not refresh when skipAuth is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    try {
      await apiClient.get('/public-401', { skipAuth: true });
    } catch (err) {
      expect((err as ApiClientError).statusCode).toBe(401);
    }

    // Only 1 fetch call — no refresh attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient.getDownloadUrl', () => {
  it('returns URL with auth headers', async () => {
    const result = await apiClient.getDownloadUrl('/exports/123/download');

    expect(result.url).toBe('http://localhost:3001/api/v1/exports/123/download');
    expect(result.headers.Authorization).toBe('Bearer access-token-123');
  });

  it('includes query params in URL', async () => {
    const result = await apiClient.getDownloadUrl('/files', { format: 'pdf' });
    expect(result.url).toContain('format=pdf');
  });
});

describe('apiClient - concurrent 401 deduplication', () => {
  it('fires only one refresh when 5 parallel requests all get 401', async () => {
    // All 5 initial requests return 401
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Token expired' }),
      });
    }

    // Single refresh call succeeds (mobile envelope shape)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          },
        }),
    });

    // All 5 retries succeed
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: `result-${i}` }),
      });
    }

    const results = await Promise.all([
      apiClient.get('/a'),
      apiClient.get('/b'),
      apiClient.get('/c'),
      apiClient.get('/d'),
      apiClient.get('/e'),
    ]);

    // All 5 should resolve successfully — envelope stripped at transport.
    expect(results).toHaveLength(5);
    results.forEach((r, i) => {
      expect(r).toEqual(`result-${i}`);
    });

    // Refresh endpoint should be called exactly once (deduplicated)
    const refreshCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);

    // setAccessToken and setRefreshToken called exactly once
    expect(mockSetAccessToken).toHaveBeenCalledTimes(1);
    expect(mockSetRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockSetAccessToken).toHaveBeenCalledWith('new-access-token');
    expect(mockSetRefreshToken).toHaveBeenCalledWith('new-refresh-token');
  });

  it('returns whatever JSON the server responded with, unchanged', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ id: 1 }, { id: 2 }]),
    });

    const result = await apiClient.get('/raw-array');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('apiClient - request timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects with 408 when a request outlives the 20s deadline', async () => {
    jest.useFakeTimers();

    // A request the network never settles — it resolves only when the
    // client's own AbortController fires.
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted.'));
          });
        }),
    );

    // Attach the rejection assertion up front: the timeout fires while the
    // timers are being advanced below, and an unhandled rejection in between
    // would fail the test on its own.
    const assertion = expect(apiClient.get('/slow')).rejects.toMatchObject({
      statusCode: 408,
      serverMessage: 'Request timed out. Check your connection.',
    });

    // `request()` awaits the auth headers before it arms the deadline — flush
    // those microtasks first, or there is no timer here yet to advance.
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(20000);

    await assertion;
  });

  it('passes an abort signal on every request and clears the timer on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: 'ok' }),
    });

    await expect(apiClient.get('/fast')).resolves.toBe('ok');

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
});

describe('URL building', () => {
  it('filters out empty string params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });

    await apiClient.get('/test', { params: { q: 'hello', empty: '' } });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('q=hello');
    expect(calledUrl).not.toContain('empty');
  });
});
