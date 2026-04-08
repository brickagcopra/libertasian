import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type {
  TrackEventPayload,
  TrackBatchPayload,
  StartSessionPayload,
  StartSessionResponse,
  HeartbeatPayload,
  EndSessionPayload,
} from '@libertasian/types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

class AnalyticsClient {
  private sessionId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  getSessionId(): string | null {
    return this.sessionId;
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

    apiClient.post('/analytics/events/auth', payload).catch(() => {
      // Fire-and-forget: silently ignore tracking errors
    });
  }

  /** Track a batch of events. Used by beacon/offline flush. */
  trackBatch(events: TrackEventPayload[]): void {
    const payload: TrackBatchPayload = { events };
    apiClient.post('/analytics/events/batch', payload).catch(() => {});
  }

  /** Start a new session. Stores sessionId internally. */
  async startSession(entryPath: string, referrer: string): Promise<void> {
    // Skip analytics session for unauthenticated users
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    try {
      const payload: StartSessionPayload = {
        deviceType: 'web',
        entryPath,
        referrer: referrer || undefined,
      };
      const response = await apiClient.post<StartSessionResponse>(
        '/analytics/sessions/start/auth',
        payload,
      );
      this.sessionId = response.sessionId;
    } catch {
      // Silently fail — analytics should never block the app
    }
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
