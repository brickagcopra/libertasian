'use client';

import { useEffect, useRef } from 'react';

import type { AdCreative } from '@/features/ads/types';

interface AdInlineBannerProps {
  creative: AdCreative;
  campaignId: string;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdInlineBanner({ creative, campaignId, onDismiss, onImpression, onClick }: AdInlineBannerProps) {
  const impressionRecorded = useRef(false);

  useEffect(() => {
    if (!impressionRecorded.current) {
      impressionRecorded.current = true;
      onImpression();
    }
  }, [onImpression]);

  return (
    <div
      className="my-6 overflow-hidden rounded-xl border"
      style={{
        backgroundColor: creative.bgColor ?? '#f9fafb',
        color: creative.textColor ?? undefined,
      }}
    >
      <div className="flex flex-col items-center gap-4 p-6 sm:flex-row">
        {creative.imageUrl && (
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg">
            <img
              src={creative.imageUrl}
              alt={creative.imageAlt ?? ''}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="flex-1 text-center sm:text-left">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">
            Sponsored
          </p>
          <h3 className="text-lg font-semibold">{creative.headline}</h3>
          {creative.bodyText && (
            <p className="mt-1 text-sm opacity-80">{creative.bodyText}</p>
          )}
        </div>

        {creative.ctaText && creative.ctaUrl && (
          <a
            href={creative.ctaUrl}
            onClick={onClick}
            className="flex-shrink-0 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors"
            style={{
              backgroundColor: creative.accentColor ?? '#111827',
            }}
          >
            {creative.ctaText}
          </a>
        )}
      </div>
    </div>
  );
}
