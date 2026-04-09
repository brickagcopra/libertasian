'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import type { AdCreative } from '@/features/ads/types';

interface AdFloatingBarProps {
  creative: AdCreative;
  campaignId: string;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdFloatingBar({ creative, campaignId, onDismiss, onImpression, onClick }: AdFloatingBarProps) {
  const impressionRecorded = useRef(false);

  useEffect(() => {
    if (!impressionRecorded.current) {
      impressionRecorded.current = true;
      onImpression();
    }
  }, [onImpression]);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-300"
      style={{
        backgroundColor: creative.bgColor ?? '#111827',
        color: creative.textColor ?? '#ffffff',
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          {creative.imageUrl && (
            <img
              src={creative.imageUrl}
              alt={creative.imageAlt ?? ''}
              className="h-8 w-8 rounded object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{creative.headline}</p>
            {creative.bodyText && (
              <p className="hidden truncate text-xs opacity-80 sm:block">{creative.bodyText}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {creative.ctaText && creative.ctaUrl && (
            <a
              href={creative.ctaUrl}
              onClick={onClick}
              className="whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: creative.accentColor ?? '#ffffff',
                color: creative.bgColor ?? '#111827',
              }}
            >
              {creative.ctaText}
            </a>
          )}
          <button
            onClick={onDismiss}
            className="rounded-full p-1 opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
