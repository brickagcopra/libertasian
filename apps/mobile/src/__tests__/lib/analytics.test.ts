jest.mock('@/lib/api-client', () => ({
  apiClient: { post: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }) },
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));

// `lib/analytics` imports expo-sqlite at module scope for its offline buffer,
// and the native module does not resolve under jest — which is why most suites
// stub the whole client, and why the store telemetry module lazy-requires it.
// This suite exercises the REAL client, so the dependency is stubbed instead.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue({ cnt: 0 }),
    getAllAsync: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    createMMKV: jest.fn().mockImplementation(() => ({
      getString: (k: string) => store.get(k),
      set: (k: string, v: string) => store.set(k, v),
      remove: (k: string) => store.delete(k),
      contains: (k: string) => store.has(k),
      getAllKeys: () => [...store.keys()],
      clearAll: () => store.clear(),
    })),
  };
});

import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

import { apiClient } from '@/lib/api-client';
import { isPermanentRejection, mobileAnalytics } from '@/lib/analytics';

const mockPost = apiClient.post as jest.Mock;

/** The client is a module singleton; clear its session between tests. */
async function resetSession(): Promise<void> {
  mockPost.mockResolvedValue(undefined);
  await mobileAnalytics.endSession();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ sessionId: 'sess-1' });
}

describe('MobileAnalyticsClient.trackPageView', () => {
  beforeEach(async () => {
    await resetSession();
  });

  it('sends page_viewed with the route pattern and surface only', () => {
    mobileAnalytics.trackPageView('/(tabs)/digests');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        eventName: 'page_viewed',
        properties: { path: '/digests', surface: 'digests' },
      }),
    );
  });

  it('keeps a router-supplied [param] rather than inventing an id', () => {
    mobileAnalytics.trackPageView('/digest/[id]');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        properties: { path: '/digest/[id]', surface: 'digests' },
      }),
    );
  });

  it('never lets a concrete id reach the request body', () => {
    // A route with a case id in it is a record of what someone researched.
    mobileAnalytics.trackPageView('/reader/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60');

    const body = JSON.stringify(mockPost.mock.calls[0]![1]);
    expect(body).not.toContain('8f1c2b64');
    expect(body).toContain('/reader/[id]');
  });

  it('files an unmapped route under other rather than dropping it', () => {
    mobileAnalytics.trackPageView('/notifications');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        properties: { path: '/notifications', surface: 'other' },
      }),
    );
  });
});

describe('deviceType on every event', () => {
  beforeEach(async () => {
    await resetSession();
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  /**
   * The platform split on the admin dashboard is only real if the client stamps
   * it. The API's fallback infers platform from a login user agent and guesses
   * "web" for anything it does not recognise, so an unstamped mobile event lands
   * in the wrong column.
   */
  it.each([
    ['ios', 'ios'],
    ['android', 'android'],
    ['web', 'web'],
  ])('stamps Platform.OS=%s as deviceType %s', async (os, expected) => {
    (Platform as { OS: string }).OS = os;
    await resetSession();

    mobileAnalytics.track('search_executed', { query_length: 3 });
    mobileAnalytics.trackPageView('/(tabs)/search');
    mobileAnalytics.trackPreAuth('social_login_failed', { provider: 'google' });

    const deviceTypes = mockPost.mock.calls.map(
      ([, body]) => (body as { deviceType?: string }).deviceType,
    );
    expect(deviceTypes).toEqual([expected, expected, expected]);
  });

  it('stamps the session too, not only the events', async () => {
    (Platform as { OS: string }).OS = 'android';
    await resetSession();

    await mobileAnalytics.ensureSession('/(tabs)/digests');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/sessions/start/auth',
      expect.objectContaining({ deviceType: 'android' }),
    );
  });
});

describe('MobileAnalyticsClient.ensureSession', () => {
  beforeEach(async () => {
    await resetSession();
  });

  it('starts a session when there is none', async () => {
    await mobileAnalytics.ensureSession('/(tabs)/digests');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/sessions/start/auth',
      expect.objectContaining({ entryPath: '/(tabs)/digests' }),
    );
    expect(mobileAnalytics.getSessionId()).toBe('sess-1');
  });

  it('does not start a second session while one is live', async () => {
    await mobileAnalytics.ensureSession('/(tabs)/digests');
    mockPost.mockClear();

    await mobileAnalytics.ensureSession('/(tabs)/search');

    expect(mockPost).not.toHaveBeenCalled();
    expect(mobileAnalytics.getSessionId()).toBe('sess-1');
  });

  it('attaches the session id to subsequent events', async () => {
    await mobileAnalytics.ensureSession('/(tabs)/digests');
    mockPost.mockClear();

    mobileAnalytics.trackPageView('/(tabs)/search');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({ sessionId: 'sess-1' }),
    );
  });

  it('falls back to a local session id when the request fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('offline'));
    await mobileAnalytics.ensureSession('/(tabs)/digests');

    expect(mobileAnalytics.getSessionId()).toMatch(/^local_/);
  });
});

describe('refused events never poison the offline buffer', () => {
  /** The stubbed database object `openDatabaseAsync` resolves to (one shared instance). */
  async function stubDb(): Promise<{ getAllAsync: jest.Mock; runAsync: jest.Mock }> {
    return (await (SQLite.openDatabaseAsync as jest.Mock)()) as {
      getAllAsync: jest.Mock;
      runAsync: jest.Mock;
    };
  }

  const flush = (): Promise<void> =>
    (mobileAnalytics as unknown as { flushBuffer(): Promise<void> }).flushBuffer();

  const bufferedRow = {
    id: 7,
    event_name: 'purchase_surface_unavailable',
    session_id: null,
    device_type: 'android',
    properties: '{"platform":"android","reason":"products_empty"}',
    duration_ms: null,
    created_at: 1,
  };

  beforeEach(async () => {
    await resetSession();
    const db = await stubDb();
    db.getAllAsync.mockReset().mockResolvedValue([]);
    db.runAsync.mockReset().mockResolvedValue(undefined);
  });

  it('classifies 400/413/422 as permanent and 401/429/5xx/network as transient', () => {
    for (const statusCode of [400, 413, 422]) {
      expect(isPermanentRejection({ statusCode })).toBe(true);
    }
    for (const statusCode of [401, 408, 429, 500, 503]) {
      expect(isPermanentRejection({ statusCode })).toBe(false);
    }
    expect(isPermanentRejection(new Error('offline'))).toBe(false);
    expect(isPermanentRejection(null)).toBe(false);
  });

  it('deletes a batch the server refused instead of replaying it forever', async () => {
    const db = await stubDb();
    db.getAllAsync.mockResolvedValueOnce([bufferedRow]);
    mockPost.mockRejectedValueOnce({ statusCode: 400, message: 'Bad Request' });

    await flush();

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM buffered_events'),
      7,
    );
  });

  it('keeps a batch that failed transiently, for the next flush', async () => {
    const db = await stubDb();
    db.getAllAsync.mockResolvedValueOnce([bufferedRow]);
    mockPost.mockRejectedValueOnce({ statusCode: 503, message: 'Unavailable' });

    await flush();

    expect(db.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM buffered_events'),
      expect.anything(),
    );
  });

  it('does not buffer a live event the server refused', async () => {
    const db = await stubDb();
    mockPost.mockRejectedValueOnce({ statusCode: 400, message: 'Bad Request' });

    mobileAnalytics.track('purchase_result', { platform: 'android', outcome: 'failed' });
    await new Promise((resolve) => setImmediate(resolve));

    const inserted = db.runAsync.mock.calls.some((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO buffered_events'),
    );
    expect(inserted).toBe(false);
  });
});
