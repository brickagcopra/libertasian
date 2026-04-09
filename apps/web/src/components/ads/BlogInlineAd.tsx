'use client';

import { useCallback, useMemo } from 'react';

import { useActiveAds, useRecordAdEvent } from '@/features/ads/hooks/use-ads';
import { AdInlineBanner } from './AdInlineBanner';

interface BlogInlineAdProps {
  /** Index of which inline_banner creative to show (0 = first, 1 = second, etc.) */
  index?: number;
  page?: string;
}

/**
 * Self-contained inline ad for blog pages.
 * Fetches active campaigns for the given page, filters for inline_banner creatives,
 * and renders the one at the specified index.
 */
export function BlogInlineAd({ index = 0, page = 'blog' }: BlogInlineAdProps) {
  const { data: campaigns } = useActiveAds(page);
  const recordEvent = useRecordAdEvent();

  const inlineBanners = useMemo(() => {
    if (!campaigns) return [];
    return campaigns.flatMap((campaign) =>
      campaign.creatives
        .filter((c) => c.displayType === 'inline_banner')
        .map((creative) => ({ campaign, creative })),
    );
  }, [campaigns]);

  const banner = inlineBanners[index];

  const handleDismiss = useCallback(() => {
    if (!banner) return;
    recordEvent.mutate({
      campaignId: banner.campaign.id,
      creativeId: banner.creative.id,
      eventType: 'dismiss',
      page,
    });
  }, [banner, recordEvent, page]);

  const handleImpression = useCallback(() => {
    if (!banner) return;
    recordEvent.mutate({
      campaignId: banner.campaign.id,
      creativeId: banner.creative.id,
      eventType: 'impression',
      page,
    });
  }, [banner, recordEvent, page]);

  const handleClick = useCallback(() => {
    if (!banner) return;
    recordEvent.mutate({
      campaignId: banner.campaign.id,
      creativeId: banner.creative.id,
      eventType: 'cta_click',
      page,
    });
  }, [banner, recordEvent, page]);

  if (!banner) return null;

  return (
    <AdInlineBanner
      creative={banner.creative}
      campaignId={banner.campaign.id}
      onDismiss={handleDismiss}
      onImpression={handleImpression}
      onClick={handleClick}
    />
  );
}
