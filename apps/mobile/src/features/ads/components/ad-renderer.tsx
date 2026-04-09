import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useAds } from './ad-provider';
import { AdModal } from './ad-modal';
import { AdSlideIn } from './ad-slide-in';
import { AdFloatingBar } from './ad-floating-bar';

/**
 * AdRenderer renders overlay-style ads (modal, slide-in, floating bar).
 * Inline banner ads are rendered directly in screen components.
 *
 * Place this component at the screen level, inside an AdProvider.
 * Don't show ads during reader or camera scan to avoid disruption.
 */
export function AdRenderer() {
  const { campaigns, visibleAds, dismissAd, recordImpression, recordClick } = useAds();
  const [delayedAds, setDelayedAds] = useState<Set<string>>(new Set());
  const [reduceMotion, setReduceMotion] = useState(false);

  // Respect reduced motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  // Handle showAfterSeconds delay
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const campaign of campaigns) {
      if (!visibleAds.has(campaign.id)) continue;
      if (delayedAds.has(campaign.id)) continue;

      if (campaign.showAfterSeconds > 0 && !reduceMotion) {
        const timer = setTimeout(() => {
          setDelayedAds((prev) => new Set(prev).add(campaign.id));
        }, campaign.showAfterSeconds * 1000);
        timers.push(timer);
      } else {
        setDelayedAds((prev) => new Set(prev).add(campaign.id));
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [campaigns, visibleAds, delayedAds, reduceMotion]);

  const elements = useMemo(() => {
    const rendered: React.ReactNode[] = [];

    for (const [campaignId, creative] of visibleAds) {
      if (!delayedAds.has(campaignId)) continue;

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
              visible
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
              visible
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
              visible
              onDismiss={handleDismiss}
              onImpression={handleImpression}
              onClick={handleClick}
            />,
          );
          break;
        // inline_banner is rendered directly in screen components
      }
    }

    return rendered;
  }, [visibleAds, delayedAds, dismissAd, recordImpression, recordClick]);

  return <>{elements}</>;
}
