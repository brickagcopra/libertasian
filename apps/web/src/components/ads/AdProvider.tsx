'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

import { useActiveAds, useRecordAdEvent } from '@/features/ads/hooks/use-ads';
import type { AdCampaign, AdCreative } from '@/features/ads/types';

interface AdContextValue {
  campaigns: AdCampaign[];
  visibleAds: Map<string, AdCreative>;
  dismissAd: (campaignId: string) => void;
  recordImpression: (campaignId: string, creativeId: string) => void;
  recordClick: (campaignId: string, creativeId: string) => void;
}

const AdContext = createContext<AdContextValue>({
  campaigns: [],
  visibleAds: new Map(),
  dismissAd: () => {},
  recordImpression: () => {},
  recordClick: () => {},
});

export function useAds() {
  return useContext(AdContext);
}

function getPageName(pathname: string): string {
  if (pathname === '/') return 'homepage';
  if (pathname.startsWith('/blog')) return 'blog';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/pricing')) return 'pricing';
  if (pathname.startsWith('/documents') || pathname.startsWith('/reader')) return 'reader';
  return 'other';
}

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let sessionId = sessionStorage.getItem('ad_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('ad_session_id', sessionId);
  }
  return sessionId;
}

export function AdProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = getPageName(pathname);
  const { data: campaigns = [] } = useActiveAds(page);
  const recordEvent = useRecordAdEvent();

  const [dismissedCampaigns, setDismissedCampaigns] = useState<Set<string>>(new Set());
  const impressionsSent = useRef<Set<string>>(new Set());
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Restore session-dismissed campaigns
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = sessionStorage.getItem('ad_dismissed');
    if (dismissed) {
      try {
        setDismissedCampaigns(new Set(JSON.parse(dismissed)));
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  const visibleAds = useMemo(() => {
    const ads = new Map<string, AdCreative>();
    const modalShown = false;

    for (const campaign of campaigns) {
      if (dismissedCampaigns.has(campaign.id)) continue;
      if (campaign.showOncePerSession) {
        const sessionDismissed = dismissedCampaigns.has(campaign.id);
        if (sessionDismissed) continue;
      }

      const creative = campaign.creatives[0];
      if (!creative) continue;

      // Limit: max 1 modal, 1 slide-in, 1 floating bar at a time
      const hasType = Array.from(ads.values()).some(
        (c) => c.displayType === creative.displayType,
      );
      if (hasType && ['modal', 'slide_in', 'floating_bar'].includes(creative.displayType)) {
        continue;
      }

      ads.set(campaign.id, creative);
    }

    return ads;
  }, [campaigns, dismissedCampaigns]);

  const dismissAd = useCallback(
    (campaignId: string) => {
      setDismissedCampaigns((prev) => {
        const next = new Set(prev);
        next.add(campaignId);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('ad_dismissed', JSON.stringify([...next]));
        }
        return next;
      });

      const creative = visibleAds.get(campaignId);
      const sessionId = getSessionId();

      // Debounced event recording
      const key = `dismiss-${campaignId}`;
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      debounceTimers.current.set(
        key,
        setTimeout(() => {
          recordEvent.mutate({
            campaignId,
            creativeId: creative?.id,
            eventType: 'dismiss',
            sessionId,
            page,
          });
        }, 300),
      );
    },
    [visibleAds, page, recordEvent],
  );

  const recordImpression = useCallback(
    (campaignId: string, creativeId: string) => {
      const key = `${campaignId}-${creativeId}`;
      if (impressionsSent.current.has(key)) return;
      impressionsSent.current.add(key);

      recordEvent.mutate({
        campaignId,
        creativeId,
        eventType: 'impression',
        sessionId: getSessionId(),
        page,
      });
    },
    [page, recordEvent],
  );

  const recordClick = useCallback(
    (campaignId: string, creativeId: string) => {
      recordEvent.mutate({
        campaignId,
        creativeId,
        eventType: 'cta_click',
        sessionId: getSessionId(),
        page,
      });
    },
    [page, recordEvent],
  );

  const value = useMemo(
    () => ({
      campaigns,
      visibleAds,
      dismissAd,
      recordImpression,
      recordClick,
    }),
    [campaigns, visibleAds, dismissAd, recordImpression, recordClick],
  );

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
}
