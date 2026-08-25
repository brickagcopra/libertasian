import { Platform, AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as SQLite from 'expo-sqlite';
import NetInfo from '@react-native-community/netinfo';

import { apiClient } from './api-client';
import { mmkvStorage, STORAGE_KEYS } from '../storage/mmkv';
import type {
  TrackEventPayload,
  TrackBatchPayload,
  StartSessionPayload,
  StartSessionResponse,
  HeartbeatPayload,
  EndSessionPayload,
  AnalyticsDeviceType,
} from '@libertasian/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANALYTICS_SESSION_KEY = 'analytics_session_id';
const ANALYTICS_FLUSH_INTERVAL_MS = 60_000; // Flush buffered events every 60s
const ANALYTICS_HEARTBEAT_INTERVAL_MS = 30_000; // Heartbeat every 30s
const ANALYTICS_BATCH_SIZE = 50; // Max events per batch flush
const ANALYTICS_MAX_BUFFER_SIZE = 1000; // Max offline events before eviction

// ---------------------------------------------------------------------------
// SQLite offline buffer
// ---------------------------------------------------------------------------

let analyticsDb: SQLite.SQLiteDatabase | null = null;

async function getAnalyticsDb(): Promise<SQLite.SQLiteDatabase> {
  if (analyticsDb) return analyticsDb;

  analyticsDb = await SQLite.openDatabaseAsync('libertasian_analytics.db');

  await analyticsDb.execAsync('PRAGMA journal_mode = WAL;');

  await analyticsDb.execAsync(`
    CREATE TABLE IF NOT EXISTS buffered_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      session_id TEXT,
      device_type TEXT NOT NULL,
      properties TEXT NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_buffered_events_created
      ON buffered_events(created_at);
  `);

  return analyticsDb;
}

// ---------------------------------------------------------------------------
// Mobile Analytics Client
// ---------------------------------------------------------------------------

interface BufferedEventRow {
  id: number;
  event_name: string;
  session_id: string | null;
  device_type: string;
  properties: string;
  duration_ms: number | null;
  created_at: string;
}

class MobileAnalyticsClient {
  private sessionId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isOnline = true;
  private currentPath = '/';
  private appStateSubscription: { remove: () => void } | null = null;
  private netInfoUnsubscribe: (() => void) | null = null;

  private get deviceType(): AnalyticsDeviceType {
    return Platform.OS === 'ios' ? 'ios' : 'android';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ─── Initialization ──────────────────────────────────────────

  /**
   * Initialize the analytics client. Call once at app startup.
   * Sets up connectivity monitoring, app state listeners, and flush interval.
   */
  async initialize(): Promise<void> {
    // Restore session from MMKV if the app was backgrounded briefly
    const storedSession = mmkvStorage.getString(ANALYTICS_SESSION_KEY);
    if (storedSession) {
      this.sessionId = storedSession;
    }

    // Monitor network connectivity
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? false;

      // Flush buffer when we come back online
      if (wasOffline && this.isOnline) {
        void this.flushBuffer();
      }
    });

    // Monitor app state changes
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange,
    );

    // Start periodic buffer flush
    this.startFlushInterval();
  }

  /**
   * Tear down the analytics client. Call on app unmount.
   */
  destroy(): void {
    this.stopHeartbeat();
    this.stopFlushInterval();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
  }

  // ─── App State Handling ──────────────────────────────────────

  private handleAppStateChange = (nextState: AppStateStatus): void => {
    if (nextState === 'active') {
      // App foregrounded — resume heartbeat & flush buffer
      this.startHeartbeat();
      void this.flushBuffer();
    } else if (nextState === 'background' || nextState === 'inactive') {
      // App backgrounded — stop heartbeat, flush remaining events
      this.stopHeartbeat();
      void this.flushBuffer();
    }
  };

  // ─── Session Management ──────────────────────────────────────

  async startSession(entryPath: string): Promise<void> {
    this.currentPath = entryPath;

    try {
      const payload: StartSessionPayload = {
        deviceType: this.deviceType,
        entryPath,
      };
      const response = await apiClient.post<StartSessionResponse>(
        '/analytics/sessions/start/auth',
        payload,
      );
      this.sessionId = response.sessionId;
      mmkvStorage.setString(ANALYTICS_SESSION_KEY, this.sessionId);
      this.startHeartbeat();
    } catch {
      // Generate a local session ID for offline tracking
      this.sessionId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      mmkvStorage.setString(ANALYTICS_SESSION_KEY, this.sessionId);
    }
  }

  async endSession(): Promise<void> {
    if (!this.sessionId) return;

    this.stopHeartbeat();

    // Flush remaining buffered events before ending session
    await this.flushBuffer();

    try {
      const payload: EndSessionPayload = { sessionId: this.sessionId };
      await apiClient.post('/analytics/sessions/end', payload);
    } catch {
      // Silently fail — session will expire server-side after inactivity
    }

    this.sessionId = null;
    mmkvStorage.delete(ANALYTICS_SESSION_KEY);
  }

  // ─── Heartbeat ───────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.sessionId || !this.isOnline) return;
      const payload: HeartbeatPayload = {
        sessionId: this.sessionId,
        currentPath: this.currentPath,
      };
      apiClient.post('/analytics/sessions/heartbeat', payload).catch(() => {});
    }, ANALYTICS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ─── Event Tracking ──────────────────────────────────────────

  /**
   * Track a single analytics event.
   * If online, sends immediately. If offline, buffers in SQLite.
   */
  track(
    eventName: string,
    properties: Record<string, unknown> = {},
    durationMs?: number,
  ): void {
    const payload: TrackEventPayload = {
      eventName,
      sessionId: this.sessionId ?? undefined,
      deviceType: this.deviceType,
      properties,
      durationMs,
    };

    if (this.isOnline) {
      apiClient.post('/analytics/events/auth', payload).catch(() => {
        // Failed to send — buffer for later
        void this.bufferEvent(payload);
      });
    } else {
      void this.bufferEvent(payload);
    }
  }

  /**
   * Track an event from a PRE-AUTH screen (login, register, forgot password).
   *
   * Posts to the UNAUTHENTICATED POST /analytics/events with `skipAuth`, not
   * to /analytics/events/auth like `track()` does. /events/auth sits behind
   * JwtAuthGuard, so routing a sign-in failure through it would 401 for
   * exactly the users whose failures we need to see — and `skipAuth` also
   * keeps a stale token from dragging the request into a refresh/sign-out
   * dance while the user is trying to log in.
   *
   * Offline events fall back to the SQLite buffer, which flushes to
   * /analytics/events/batch — also unauthenticated, so a pre-auth event that
   * was buffered still lands.
   *
   * Callers must never put token material or raw PII in `properties`.
   */
  trackPreAuth(eventName: string, properties: Record<string, unknown> = {}): void {
    const payload: TrackEventPayload = {
      eventName,
      sessionId: this.sessionId ?? undefined,
      deviceType: this.deviceType,
      properties,
    };

    if (this.isOnline) {
      apiClient.post('/analytics/events', payload, { skipAuth: true }).catch(() => {
        void this.bufferEvent(payload);
      });
    } else {
      void this.bufferEvent(payload);
    }
  }

  /** Update the current path for heartbeat tracking. */
  setCurrentPath(path: string): void {
    this.currentPath = path;
  }

  // ─── Offline Buffer ──────────────────────────────────────────

  private async bufferEvent(payload: TrackEventPayload): Promise<void> {
    try {
      const db = await getAnalyticsDb();

      // Enforce max buffer size — evict oldest events
      const countResult = (await db.getFirstAsync(
        'SELECT COUNT(*) as cnt FROM buffered_events',
      )) as { cnt: number } | null;

      if ((countResult?.cnt ?? 0) >= ANALYTICS_MAX_BUFFER_SIZE) {
        await db.runAsync(
          `DELETE FROM buffered_events WHERE id IN (
            SELECT id FROM buffered_events ORDER BY created_at ASC LIMIT 100
          )`,
        );
      }

      await db.runAsync(
        `INSERT INTO buffered_events (event_name, session_id, device_type, properties, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        payload.eventName,
        payload.sessionId ?? null,
        payload.deviceType ?? this.deviceType,
        JSON.stringify(payload.properties),
        payload.durationMs ?? null,
        new Date().toISOString(),
      );
    } catch {
      // Drop the event if we can't even buffer it
    }
  }

  private async flushBuffer(): Promise<void> {
    if (!this.isOnline) return;

    try {
      const db = await getAnalyticsDb();

      const rows: BufferedEventRow[] = await db.getAllAsync(
        `SELECT * FROM buffered_events ORDER BY created_at ASC LIMIT ?`,
        ANALYTICS_BATCH_SIZE,
      );

      if (rows.length === 0) return;

      const events: TrackEventPayload[] = rows.map((row) => ({
        eventName: row.event_name,
        sessionId: row.session_id ?? undefined,
        deviceType: (row.device_type as AnalyticsDeviceType) ?? this.deviceType,
        properties: JSON.parse(row.properties) as Record<string, unknown>,
        durationMs: row.duration_ms ?? undefined,
      }));

      const batchPayload: TrackBatchPayload = { events };

      await apiClient.post('/analytics/events/batch', batchPayload);

      // Delete flushed events
      const ids = rows.map((r) => r.id);
      await db.runAsync(
        `DELETE FROM buffered_events WHERE id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      );

      // If there are more events, schedule another flush
      const remaining = (await db.getFirstAsync(
        'SELECT COUNT(*) as cnt FROM buffered_events',
      )) as { cnt: number } | null;

      if ((remaining?.cnt ?? 0) > 0) {
        // Flush more in the next tick
        setTimeout(() => void this.flushBuffer(), 100);
      }
    } catch {
      // Will retry on next flush interval
    }
  }

  private startFlushInterval(): void {
    this.stopFlushInterval();
    this.flushInterval = setInterval(() => {
      void this.flushBuffer();
    }, ANALYTICS_FLUSH_INTERVAL_MS);
  }

  private stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  // ─── Buffer Stats (for debugging) ───────────────────────────

  async getBufferStats(): Promise<{ count: number; oldestAt: string | null }> {
    try {
      const db = await getAnalyticsDb();
      const count = (await db.getFirstAsync(
        'SELECT COUNT(*) as cnt FROM buffered_events',
      )) as { cnt: number } | null;
      const oldest = (await db.getFirstAsync(
        'SELECT MIN(created_at) as val FROM buffered_events',
      )) as { val: string | null } | null;
      return { count: count?.cnt ?? 0, oldestAt: oldest?.val ?? null };
    } catch {
      return { count: 0, oldestAt: null };
    }
  }
}

export const mobileAnalytics = new MobileAnalyticsClient();
