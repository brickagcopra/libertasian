'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { analytics } from '@/lib/analytics';

interface AnalyticsContextValue {
  analytics: typeof analytics;
  sessionId: string | null;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({
  analytics,
  sessionId: null,
});

export function useAnalyticsContext() {
  return useContext(AnalyticsContext);
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const initialized = useRef(false);

  // Keep pathname ref in sync for heartbeat
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Start session on mount, end on unload
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    analytics.startSession(window.location.pathname, document.referrer);
    analytics.startHeartbeat(() => pathnameRef.current);

    const handleBeforeUnload = () => {
      analytics.endSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        analytics.endSession();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      analytics.stopHeartbeat();
      analytics.endSession();
    };
  }, []);

  return (
    <AnalyticsContext.Provider value={{ analytics, sessionId: analytics.getSessionId() }}>
      {children}
    </AnalyticsContext.Provider>
  );
}
