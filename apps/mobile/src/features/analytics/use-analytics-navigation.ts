import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useSegments } from 'expo-router';

import { mobileAnalytics } from '../../lib/analytics';

/**
 * Build a path from Expo Router's segments.
 *
 * `useSegments()` returns the ROUTE segments, so a dynamic route arrives as
 * `['digest', '[id]']` rather than with the real id in it — which is why this is
 * preferred over `usePathname()` here. `routePatternForPath` in the shared map
 * redacts anything that slips through anyway, so this is belt and braces rather
 * than the only guard.
 */
function pathFromSegments(segments: string[]): string {
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

/**
 * Navigation instrumentation for the mobile app: one `page_viewed` per route
 * change, and a session that starts on mount and resumes on every foreground.
 *
 * Mounted once in the root layout, next to the other app-wide hooks, for the
 * same reason they are: exactly one component should hold this while any number
 * of screens navigate underneath it.
 *
 * Before this, mobile emitted nothing on navigation and never started a session
 * at all — `analytics_events` held 60 rows in its entire history, all of them
 * pre-auth sign-in failures, and `analytics_sessions` held 2, both from web.
 *
 * Tracking is gated on `isAuthenticated` because `mobileAnalytics.track` posts
 * to `/analytics/events/auth`, which sits behind `JwtAuthGuard`: firing while
 * signed out would 401 every event on the login and onboarding screens. Pre-auth
 * telemetry has its own path (`trackPreAuth`).
 */
export function useAnalyticsNavigationTracking(isAuthenticated: boolean): void {
  const segments = useSegments();
  const path = useMemo(() => pathFromSegments(segments as string[]), [segments]);

  // The foreground handler needs the CURRENT path, but must not re-subscribe on
  // every navigation — a ref rather than a dependency.
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // Connectivity monitoring, the offline-buffer flush loop and the app-state
  // listener the client owns. Nothing called this before, so the SQLite buffer
  // never drained and the session was never restored from MMKV.
  useEffect(() => {
    void mobileAnalytics.initialize();
    return () => mobileAnalytics.destroy();
  }, []);

  // Session on mount and on every foreground. `ensureSession` is a no-op when a
  // session is already live, so a user switching apps repeatedly gets one
  // session rather than one per switch.
  useEffect(() => {
    if (!isAuthenticated) return;

    void mobileAnalytics.ensureSession(pathRef.current);

    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        void mobileAnalytics.ensureSession(pathRef.current);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [isAuthenticated]);

  // One page view per route change.
  useEffect(() => {
    if (!isAuthenticated) return;
    mobileAnalytics.trackPageView(path);
  }, [isAuthenticated, path]);
}
