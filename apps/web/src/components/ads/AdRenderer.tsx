'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAds } from './AdProvider';
import { AdModal } from './AdModal';
import { AdSlideIn } from './AdSlideIn';
import { AdFloatingBar } from './AdFloatingBar';

export function AdRenderer() {
  const { campaigns, visibleAds, dismissAd, recordImpression, recordClick } = useAds();
  const [delayedAds, setDelayedAds] = useState<Set<string>>(new Set());

  // Handle showAfterSeconds delay
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    for (const campaign of campaigns) {
      if (!visibleAds.has(campaign.id)) continue;
      if (delayedAds.has(campaign.id)) continue;

      if (campaign.showAfterSeconds > 0) {
        const timer = setTimeout(() => {
          setDelayedAds((prev) => new Set(prev).add(campaign.id));
        }, campaign.showAfterSeconds * 1000);
        timers.push(timer);
      } else {
        setDelayedAds((prev) => new Set(prev).add(campaign.id));
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [campaigns, visibleAds, delayedAds]);

  // Check reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const renderAds = useMemo(() => {
    const rendered: React.ReactNode[] = [];

    for (const [campaignId, creative] of visibleAds) {
      if (!delayedAds.has(campaignId)) continue;

      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) continue;

      const handleDismiss = () => dismissAd(campaignId);
      const handleImpression = () => recordImpression(campaignId, creative.id);
      const handleClick = () => recordClick(campaignId, creative.id);

      switch (creative.displayType) {
        case 'modal':
          rendered.push(
            <AdModal
              key={campaignId}
              creative={creative}
              campaignId={campaignId}
              showAfterSeconds={campaign.showAfterSeconds}
              onDismiss={handleDismiss}
              onImpression={handleImpression}
              onClick={handleClick}
            />,
          );
          break;
        case 'slide_in':
          rendered.push(
            <AdSlideIn
              key={campaignId}
              creative={creative}
              campaignId={campaignId}
              onDismiss={handleDismiss}
              onImpression={handleImpression}
              onClick={handleClick}
            />,
          );
          break;
        case 'floating_bar':
        case 'sticky_footer':
          rendered.push(
            <AdFloatingBar
              key={campaignId}
              creative={creative}
              campaignId={campaignId}
              onDismiss={handleDismiss}
              onImpression={handleImpression}
              onClick={handleClick}
            />,
          );
          break;
        // inline_banner is rendered manually in page components, not here
      }
    }

    return rendered;
  }, [visibleAds, delayedAds, campaigns, dismissAd, recordImpression, recordClick]);

  return <>{renderAds}</>;
}
