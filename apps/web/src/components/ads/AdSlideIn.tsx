'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import type { AdCreative } from '@/features/ads/types';

interface AdSlideInProps {
  creative: AdCreative;
  campaignId: string;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdSlideIn({ creative, campaignId, onDismiss, onImpression, onClick }: AdSlideInProps) {
  const impressionRecorded = useRef(false);

  useEffect(() => {
    if (!impressionRecorded.current) {
      impressionRecorded.current = true;
      onImpression();
    }
  }, [onImpression]);

  const positionClasses = {
    bottom_right: 'bottom-4 right-4',
    bottom_left: 'bottom-4 left-4',
    top_right: 'top-4 right-4',
  };

  const position = (creative.position as keyof typeof positionClasses) || 'bottom_right';

  return (
    <div
      className={`fixed z-50 w-full max-w-sm animate-in slide-in-from-bottom-5 duration-300 sm:${positionClasses[position]}`}
      style={{
        backgroundColor: creative.bgColor ?? '#ffffff',
        color: creative.textColor ?? undefined,
      }}
    >
      <div className="overflow-hidden rounded-xl border shadow-lg">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute right-2 top-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-3 p-4">
          {/* Image */}
          {creative.imageUrl && (
            <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
              <img
                src={creative.imageUrl}
                alt={creative.imageAlt ?? ''}
                className="h-full w-full object-cover"
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 pr-4">
            <h3 className="text-sm font-semibold">{creative.headline}</h3>
            {creative.bodyText && (
              <p className="mt-1 line-clamp-2 text-xs opacity-80">{creative.bodyText}</p>
            )}
            {creative.ctaText && creative.ctaUrl && (
              <a
                href={creative.ctaUrl}
                onClick={onClick}
                className="mt-2 inline-block rounded-md px-3 py-1 text-xs font-semibold text-white"
                style={{
                  backgroundColor: creative.accentColor ?? '#111827',
                }}
              >
                {creative.ctaText}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
