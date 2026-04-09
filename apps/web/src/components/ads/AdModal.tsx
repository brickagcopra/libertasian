'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import type { AdCreative } from '@/features/ads/types';

interface AdModalProps {
  creative: AdCreative;
  campaignId: string;
  showAfterSeconds: number;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdModal({
  creative,
  campaignId,
  showAfterSeconds,
  onDismiss,
  onImpression,
  onClick,
}: AdModalProps) {
  const impressionRecorded = useRef(false);

  useEffect(() => {
    if (!impressionRecorded.current) {
      impressionRecorded.current = true;
      onImpression();
    }
  }, [onImpression]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="relative mx-4 w-full max-w-lg animate-in fade-in zoom-in-95 overflow-hidden rounded-xl border bg-white shadow-2xl duration-300"
        style={{
          backgroundColor: creative.bgColor ?? undefined,
          color: creative.textColor ?? undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Image */}
        {creative.imageUrl && (
          <div className="overflow-hidden">
            <img
              src={creative.imageUrl}
              alt={creative.imageAlt ?? ''}
              className="w-full object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div className="p-6">
          <h2 className="text-xl font-bold">{creative.headline}</h2>
          {creative.bodyText && (
            <p className="mt-2 text-sm opacity-80">{creative.bodyText}</p>
          )}

          {/* CTAs */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {creative.ctaText && creative.ctaUrl && (
              <a
                href={creative.ctaUrl}
                onClick={onClick}
                className="inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
                style={{
                  backgroundColor:
                    creative.accentColor ?? (creative.ctaStyle === 'primary' ? '#111827' : '#6b7280'),
                }}
              >
                {creative.ctaText}
              </a>
            )}
            {creative.secondaryCtaText && (
              <button
                onClick={onDismiss}
                className="inline-flex items-center justify-center rounded-lg border px-6 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                {creative.secondaryCtaText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
