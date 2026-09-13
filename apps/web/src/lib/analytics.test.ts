import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: vi.fn(() => ({ accessToken: 'token' })) },
}));

import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { analytics } from './analytics';

const mockPost = vi.mocked(apiClient.post);

/**
 * `analytics` is a module singleton, so `sessionId` leaks between tests and has
 * to be cleared. `endSession` prefers `navigator.sendBeacon`, which happy-dom
 * implements as a REAL network request — stub it so the reset is local.
 */
function resetSession(): void {
  const beacon = vi.fn(() => true);
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    value: beacon,
    configurable: true,
    writable: true,
  });
  analytics.endSession();
}

describe('AnalyticsClient.startSession', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({} as never);
    vi.mocked(useAuthStore.getState).mockReturnValue({ accessToken: 'token' } as never);
    resetSession();
    mockPost.mockReset();
    mockPost.mockResolvedValue({} as never);
  });

  it('reads sessionId out of the {success, data} envelope', async () => {
    /**
     * Web's `apiClient` returns the response body verbatim — it does NOT unwrap
     * the envelope the way mobile's does. Reading `response.sessionId` yielded
     * undefined, so `sessionId` stayed null forever: every event this client has
     * ever sent was sessionless and analytics_sessions held 2 rows.
     */
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess-abc' },
    } as never);

    await analytics.startSession('/digests', '');

    expect(analytics.getSessionId()).toBe('sess-abc');
  });

  it('attaches that sessionId to subsequent events', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess-abc' },
    } as never);
    await analytics.startSession('/digests', '');

    mockPost.mockClear();
    analytics.track('page_viewed', { path: '/digests', surface: 'digests' });

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({ sessionId: 'sess-abc' }),
    );
  });

  it('stays null rather than undefined when the payload has no session', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} } as never);
    await analytics.startSession('/digests', '');
    expect(analytics.getSessionId()).toBeNull();
  });

  it('skips the request entirely when unauthenticated', async () => {
    vi.mocked(useAuthStore.getState).mockReturnValue({ accessToken: null } as never);
    await analytics.startSession('/digests', '');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('swallows a failed session start', async () => {
    mockPost.mockRejectedValueOnce(new Error('offline'));
    await expect(analytics.startSession('/digests', '')).resolves.toBeUndefined();
    expect(analytics.getSessionId()).toBeNull();
  });
});

describe('AnalyticsClient.trackPageView', () => {
  beforeEach(() => {
    resetSession();
    mockPost.mockReset();
    mockPost.mockResolvedValue({} as never);
  });

  it('sends page_viewed with the route pattern and surface only', () => {
    analytics.trackPageView('/digests/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        eventName: 'page_viewed',
        deviceType: 'web',
        properties: { path: '/digests/[id]', surface: 'digests' },
      }),
    );
  });

  it('never lets a concrete id reach the request body', () => {
    // A route with a case id in it is a record of what someone researched.
    analytics.trackPageView('/reader/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60');

    const body = JSON.stringify(mockPost.mock.calls[0]![1]);
    expect(body).not.toContain('8f1c2b64');
  });

  it('drops a query string that could carry search text', () => {
    analytics.trackPageView('/search?q=people+v+dela+cruz');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        properties: { path: '/search', surface: 'search' },
      }),
    );
  });

  it('files an unmapped route under other rather than dropping it', () => {
    analytics.trackPageView('/settings/billing');

    expect(mockPost).toHaveBeenCalledWith(
      '/analytics/events/auth',
      expect.objectContaining({
        properties: { path: '/settings/billing', surface: 'other' },
      }),
    );
  });
});
