import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { pageViewProperties } from '@/lib/analytics-surfaces';
import type {
  TrackEventPayload,
  TrackBatchPayload,
  StartSessionPayload,
  StartSessionResponse,
  HeartbeatPayload,
  EndSessionPayload,
} from '@libertasian/types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

/**
 * Every API handler returns `{ success, data }` and web's `apiClient` returns
 * the response body verbatim — it does NOT unwrap, unlike mobile's client.
 * Reading `response.sessionId` off the envelope therefore yielded `undefined`
 * and left `sessionId` null forever, so every event this client has ever sent
 * was sessionless and `analytics_sessions` held 2 rows. Type the call as the
 * envelope and unwrap explicitly.
 */
type ApiEnvelope<T> = { success: boolean; data: T };

class AnalyticsClient {
  private sessionId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * True when the auth store currently holds an access token.
   *
   * Every `/analytics/…/auth` endpoint is behind `JwtAuthGuard`. Posting to
   * one without a token returns 401, and a 401 is indistinguishable from an
   * expired session to the api-client — which is how a page view on the
   * anonymous landing page ended up hard-redirecting the visitor to /login.
   * Analytics must never be able to produce that 401: choose the public twin
   * of the endpoint instead. The public handlers take the identical DTO and
   * simply attribute the row to no user.
   */
  private isAuthenticated(): boolean {
    return Boolean(useAuthStore.getState().accessToken);
  }

  /** Track a single event. Fire-and-forget. */
  track(eventName: string, properties: Record<string, unknown> = {}, durationMs?: number): void {
    const payload: TrackEventPayload = {
      eventName,
      sessionId: this.sessionId ?? undefined,
      deviceType: 'web',
      properties,
      durationMs,
    };

    // Anonymous page views are still recorded — on the public endpoint, where
    // they belong. Dropping them would blind the funnel at exactly the step
    // (landing → register) we most need to see.
    const endpoint = this.isAuthenticated() ? '/analytics/events/auth' : '/analytics/events';

    apiClient.post(endpoint, payload).catch(() => {
      // Fire-and-forget: silently ignore tracking errors
    });
  }

  /**
   * Track a batch of events. Used by beacon/offline flush.
   *
   * `/analytics/events/batch` is public by design (it is the mobile offline
   * sync endpoint) and has no `/auth` twin, so this is already safe for an
   * anonymous visitor. The guard stays explicit so that adding an authed
   * variant later cannot reintroduce a tokenless 401 from a public page.
   */
  trackBatch(events: TrackEventPayload[]): void {
    const payload: TrackBatchPayload = { events };
    apiClient.post('/analytics/events/batch', payload).catch(() => {});
  }

  /** Start a new session. Stores sessionId internally. */
  async startSession(entryPath: string, referrer: string): Promise<void> {
    // Skip analytics session for unauthenticated users: the only session-start
    // endpoint this client uses is the guarded one, so calling it without a
    // token would be a 401 from a public page. Anonymous events are sent
    // sessionless via `track()` above.
    if (!this.isAuthenticated()) return;

    try {
      const payload: StartSessionPayload = {
        deviceType: 'web',
        entryPath,
        referrer: referrer || undefined,
      };
      const response = await apiClient.post<ApiEnvelope<StartSessionResponse>>(
        '/analytics/sessions/start/auth',
        payload,
      );
      this.sessionId = response.data?.sessionId ?? null;
    } catch {
      // Silently fail — analytics should never block the app
    }
  }

  /**
   * Track a navigation. `path` is the route PATTERN and `surface` the bucket
   * from the shared route map — see `lib/analytics-surfaces.ts`. Concrete ids
   * are stripped there, not here, so web and mobile cannot disagree about what
   * is safe to send.
   */
  trackPageView(pathname: string): void {
    this.track('page_viewed', pageViewProperties(pathname));
  }

  /** Send heartbeat with current path. */
  heartbeat(currentPath: string): void {
    if (!this.sessionId) return;
    const payload: HeartbeatPayload = {
      sessionId: this.sessionId,
      currentPath,
    };
    apiClient.post('/analytics/sessions/heartbeat', payload).catch(() => {});
  }

  /** Start the 30-second heartbeat interval. */
  startHeartbeat(getPath: () => string): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat(getPath());
    }, 30_000);
  }

  /** Stop the heartbeat interval. */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * End the current session.
   * Uses navigator.sendBeacon for page unload reliability, falls back to fetch.
   */
  endSession(): void {
    if (!this.sessionId) return;

    const payload: EndSessionPayload = { sessionId: this.sessionId };
    const body = JSON.stringify(payload);

    // Try sendBeacon first (reliable during page unload)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const url = `${API_BASE_URL}/analytics/sessions/end`;
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) {
        this.sessionId = null;
        return;
      }
    }

    // Fallback to fetch (fire-and-forget)
    apiClient.post('/analytics/sessions/end', payload).catch(() => {});
    this.sessionId = null;
  }
}

export const analytics = new AnalyticsClient();
