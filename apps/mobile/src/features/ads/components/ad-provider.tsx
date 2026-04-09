import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { mmkvStorage, STORAGE_KEYS } from '../../../storage/mmkv';
import { useActiveAds, useRecordAdEvent } from '../hooks/use-ads';
import type { AdCampaign, AdCreative } from '../types';

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

function getSessionId(): string {
  let sessionId = mmkvStorage.getString(STORAGE_KEYS.AD_SESSION_ID);
  if (!sessionId) {
    sessionId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    mmkvStorage.setString(STORAGE_KEYS.AD_SESSION_ID, sessionId);
  }
  return sessionId;
}

function getDismissedIds(): Set<string> {
  const raw = mmkvStorage.getString(STORAGE_KEYS.AD_DISMISSED_IDS);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>): void {
  mmkvStorage.setString(STORAGE_KEYS.AD_DISMISSED_IDS, JSON.stringify([...ids]));
}

interface AdProviderProps {
  page: string;
  userType?: string;
  children: React.ReactNode;
}

export function AdProvider({ page, userType, children }: AdProviderProps) {
  const { data } = useActiveAds(page, userType);
  const recordEvent = useRecordAdEvent();

  const campaigns = data?.data ?? [];
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissedIds);
  const impressedRef = useRef<Set<string>>(new Set());
  const sessionId = useMemo(() => getSessionId(), []);

  // Determine which ads to show
  const visibleAds = useMemo(() => {
    const map = new Map<string, AdCreative>();

    for (const campaign of campaigns) {
      if (dismissed.has(campaign.id)) continue;
      if (campaign.showOncePerSession && dismissed.has(`session:${campaign.id}`)) continue;

      const creative = campaign.creatives[0];
      if (!creative) continue;

      map.set(campaign.id, creative);
    }

    return map;
  }, [campaigns, dismissed]);

  const dismissAd = useCallback(
    (campaignId: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(campaignId);
        next.add(`session:${campaignId}`);
        saveDismissedIds(next);
        return next;
      });

      const creative = visibleAds.get(campaignId);
      recordEvent.mutate({
        campaignId,
        creativeId: creative?.id,
        eventType: 'dismiss',
        sessionId,
        page,
      });
    },
    [visibleAds, recordEvent, sessionId, page],
  );

  const recordImpression = useCallback(
    (campaignId: string, creativeId: string) => {
      const key = `${campaignId}:${creativeId}`;
      if (impressedRef.current.has(key)) return;
      impressedRef.current.add(key);

      recordEvent.mutate({
        campaignId,
        creativeId,
        eventType: 'impression',
        sessionId,
        page,
      });
    },
    [recordEvent, sessionId, page],
  );

  const recordClick = useCallback(
    (campaignId: string, creativeId: string) => {
      recordEvent.mutate({
        campaignId,
        creativeId,
        eventType: 'cta_click',
        sessionId,
        page,
      });
    },
    [recordEvent, sessionId, page],
  );

  const value = useMemo(
    () => ({ campaigns, visibleAds, dismissAd, recordImpression, recordClick }),
    [campaigns, visibleAds, dismissAd, recordImpression, recordClick],
  );

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
}
