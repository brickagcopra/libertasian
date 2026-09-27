'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { ExternalLinkIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { formatCourt, formatSourceDate, readerPinpointHref } from '../lib/format';
import type { DeepResearchSource } from '../schemas';

const CLOSE_DELAY_MS = 150;

/**
 * Numbered citation chip. Hover (pointer) or tap/click (touch, keyboard)
 * opens a popover with the verbatim quote the verifier accepted and the
 * source's identity, plus a pinpoint link into the reader.
 */
export function CitationChip({
  number,
  source,
  quote,
}: {
  number: number;
  source: DeepResearchSource | undefined;
  quote: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const court = formatCourt(source?.court);
  const date = formatSourceDate(source?.date);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={`Source ${number}${source ? `: ${source.title}` : ''}`}
        data-testid="citation-chip"
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') openNow();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') closeSoon();
        }}
        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-warm-accent/40 bg-warm-accent-soft px-1.5 align-text-top font-mono text-[11px] font-semibold leading-none text-warm-accent-deep transition hover:bg-warm-accent hover:text-warm-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-accent"
      >
        {number}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-3 bg-warm-surface text-warm-ink"
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') cancelClose();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') closeSoon();
        }}
        data-testid="citation-popover"
      >
        {quote.trim() && (
          <blockquote className="border-l-2 border-warm-accent pl-3 font-serif text-sm italic leading-6 text-warm-ink-soft">
            “{quote.trim()}”
          </blockquote>
        )}
        {source ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5">{source.title}</p>
            {(source.citation || source.grNo) && (
              <p className="text-xs text-warm-ink-mid">{source.citation ?? source.grNo}</p>
            )}
            {(court || date) && (
              <p className="text-xs text-warm-ink-mid">
                {[court, date].filter(Boolean).join(' · ')}
              </p>
            )}
            {source.sectionLabel && (
              <p className="text-xs text-warm-ink-faint">{source.sectionLabel}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-warm-ink-mid">Source details are unavailable.</p>
        )}
        {source && (
          <Link
            href={readerPinpointHref(source, quote)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-warm-accent-deep hover:underline"
          >
            Open in reader
            <ExternalLinkIcon className="size-3" aria-hidden />
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
