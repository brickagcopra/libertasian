import { fetch as expoFetch } from 'expo/fetch';

import { apiClient } from '../../lib/api-client';
import { authStorage } from '../../storage/auth-storage';
import { streamAiAnswer } from './stream-ai-answer';
import type { StreamAiAnswerHandlers } from './stream-ai-answer';

jest.mock('../../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: jest.fn(),
    getRefreshToken: jest.fn(),
    setAccessToken: jest.fn(),
    setRefreshToken: jest.fn(),
  },
}));

const mockExpoFetch = expoFetch as jest.MockedFunction<typeof expoFetch>;
const mockGetAccessToken = authStorage.getAccessToken as jest.MockedFunction<
  typeof authStorage.getAccessToken
>;

/**
 * A 401 with no body. `expo/fetch` responses are only ever read for `.status`,
 * `.ok`, `.body` and `.text()` on this path.
 */
function unauthorized() {
  return { status: 401, ok: false, body: null, text: async () => '' } as never;
}

/**
 * A 200 whose body is a single SSE `done` frame, delivered without a
 * ReadableStream so the client takes the buffered fallback branch. That branch
 * runs the same frame parser, which is all these tests need to observe.
 */
function streamedDone() {
  return {
    status: 200,
    ok: true,
    body: null,
    text: async () => 'data: {"type":"done","confidence":0.9}\n',
  } as never;
}

describe('streamAiAnswer — 401 refresh and retry', () => {
  let handlers: StreamAiAnswerHandlers & {
    onError: jest.Mock;
    onDone: jest.Mock;
  };
  let attemptRefresh: jest.SpyInstance;
  let notifyUnauthorized: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = { onError: jest.fn(), onDone: jest.fn() };
    attemptRefresh = jest.spyOn(apiClient, 'attemptRefresh');
    notifyUnauthorized = jest.spyOn(apiClient, 'notifyUnauthorized').mockImplementation(() => {});
  });

  afterEach(() => {
    attemptRefresh.mockRestore();
    notifyUnauthorized.mockRestore();
  });

  it('401 -> refresh succeeds -> retry succeeds: no auth error, retry carries the NEW token', async () => {
    // The stale token is what attempt 1 sends; the refreshed one must be what
    // attempt 2 sends. Reusing the captured stale token is the regression this
    // guards — the token is read before the request, so a naive retry replays it.
    mockGetAccessToken.mockResolvedValueOnce('stale-token').mockResolvedValueOnce('fresh-token');
    attemptRefresh.mockResolvedValue(true);
    mockExpoFetch.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(streamedDone());

    await streamAiAnswer({ query: 'q' }, handlers, new AbortController().signal);

    expect(attemptRefresh).toHaveBeenCalledTimes(1);
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);

    const authHeader = (call: number) =>
      (mockExpoFetch.mock.calls[call]?.[1]?.headers as Record<string, string>)['Authorization'];
    expect(authHeader(0)).toBe('Bearer stale-token');
    expect(authHeader(1)).toBe('Bearer fresh-token');

    // The user never sees the lapse, and the session is NOT torn down.
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(notifyUnauthorized).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('401 -> refresh fails: auth error surfaced exactly once, no second request', async () => {
    mockGetAccessToken.mockResolvedValue('stale-token');
    attemptRefresh.mockResolvedValue(false);
    mockExpoFetch.mockResolvedValue(unauthorized());

    await streamAiAnswer({ query: 'q' }, handlers, new AbortController().signal);

    expect(attemptRefresh).toHaveBeenCalledTimes(1);
    // No point reissuing with a token the refresh could not replace.
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith({
      kind: 'auth',
      message: 'Session expired. Please log in again.',
    });
    expect(notifyUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('401 -> refresh succeeds -> retry also 401s: auth error surfaced exactly once', async () => {
    mockGetAccessToken.mockResolvedValue('any-token');
    attemptRefresh.mockResolvedValue(true);
    mockExpoFetch.mockResolvedValue(unauthorized());

    await streamAiAnswer({ query: 'q' }, handlers, new AbortController().signal);

    // Retried once and only once — a refresh loop against a genuinely dead
    // session would spend quota units on every pass.
    expect(attemptRefresh).toHaveBeenCalledTimes(1);
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith({
      kind: 'auth',
      message: 'Session expired. Please log in again.',
    });
    expect(notifyUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('refreshes through apiClient rather than posting to /auth/refresh itself', async () => {
    // Refresh tokens are single-use with rotation and reuse detection revokes
    // the whole token family, so a second refresh path here would sign the
    // account out on every device. The stream client must own no refresh call.
    const globalFetch = jest.spyOn(globalThis, 'fetch');
    mockGetAccessToken.mockResolvedValue('stale-token');
    attemptRefresh.mockResolvedValue(true);
    mockExpoFetch.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(streamedDone());

    await streamAiAnswer({ query: 'q' }, handlers, new AbortController().signal);

    expect(attemptRefresh).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    const refreshCalls = mockExpoFetch.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(0);

    globalFetch.mockRestore();
  });

  it('does not surface an auth error when the caller aborted during the refresh', async () => {
    const controller = new AbortController();
    mockGetAccessToken.mockResolvedValue('stale-token');
    attemptRefresh.mockImplementation(async () => {
      controller.abort();
      return false;
    });
    mockExpoFetch.mockResolvedValue(unauthorized());

    await streamAiAnswer({ query: 'q' }, handlers, controller.signal);

    // Navigating away mid-refresh is not a session failure and must not sign
    // the user out.
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(notifyUnauthorized).not.toHaveBeenCalled();
  });
});
