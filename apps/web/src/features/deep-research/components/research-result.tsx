'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckIcon, CopyIcon, MessageSquarePlusIcon, ShieldCheckIcon } from 'lucide-react';

import { ContentDisclaimer } from '@/components/content-disclaimer';
import { Button } from '@/components/ui/button';

import {
  citedSources,
  formatCourt,
  formatSourceDate,
  groupSources,
  numberSources,
  readerPinpointHref,
  toPlainText,
} from '../lib/format';
import type { DeepResearchResult, DeepResearchSource } from '../schemas';
import { CitationChip } from './citation-chip';
import { AbstainedCard } from './error-cards';

export function ResearchResult({
  question,
  result,
  sources,
  onFollowUp,
}: {
  question: string | null;
  result: DeepResearchResult;
  sources: DeepResearchSource[];
  onFollowUp?: () => void;
}) {
  const numbers = useMemo(() => numberSources(sources), [sources]);
  const bySourceId = useMemo(() => new Map(sources.map((s) => [s.sourceId, s])), [sources]);
  const cited = useMemo(() => citedSources(result, sources), [result, sources]);
  const groups = useMemo(() => groupSources(cited), [cited]);
  const [copied, setCopied] = useState(false);

  if (result.abstained) {
    return <AbstainedCard reason={result.abstainReason} />;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(question, result, sources));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]" data-testid="research-result">
      <article className="min-w-0 space-y-6">
        <div className="rounded-xl border border-warm-ink/10 bg-warm-surface p-5 sm:p-6">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
            Summary
          </p>
          <p className="mt-2 whitespace-pre-line font-serif text-[17px] leading-7 text-warm-ink">
            {result.summary}
          </p>
        </div>

        {result.sections.map((section, si) => (
          <section key={`${si}-${section.heading}`} className="space-y-3">
            <h2 className="font-serif text-xl font-semibold text-warm-ink">{section.heading}</h2>
            <div className="space-y-3">
              {section.claims.map((claim, ci) => {
                // One chip per source, in chip-number order; the first quote
                // for a source is the one its popover shows.
                const firstBySource = new Map<string, string>();
                for (const c of claim.citations) {
                  if (!firstBySource.has(c.sourceId)) firstBySource.set(c.sourceId, c.quote);
                }
                const chips = [...firstBySource.entries()]
                  .map(([sourceId, quote]) => ({
                    sourceId,
                    quote,
                    n: numbers.get(sourceId) ?? 0,
                  }))
                  // A label that is not in `sources` points at nothing a reader
                  // could open; it gets no chip rather than a "0".
                  .filter((c) => c.n > 0)
                  .sort((a, b) => a.n - b.n);
                return (
                  <p key={ci} className="text-[15px] leading-7 text-warm-ink-soft">
                    {claim.text}
                    {chips.length > 0 && ' '}
                    {chips.map((c) => (
                      <CitationChip
                        key={c.sourceId}
                        number={c.n}
                        source={bySourceId.get(c.sourceId)}
                        quote={c.quote}
                      />
                    ))}
                  </p>
                );
              })}
            </div>
          </section>
        ))}

        {result.removedClaims > 0 && (
          <p
            className="flex items-center gap-2 rounded-md bg-warm-cream-2 px-3 py-2 text-xs text-warm-ink-mid"
            data-testid="removed-claims"
          >
            <ShieldCheckIcon className="size-3.5 shrink-0 text-warm-accent-deep" aria-hidden />
            {result.removedClaims === 1
              ? '1 unsupported statement was removed during verification.'
              : `${result.removedClaims} unsupported statements were removed during verification.`}
          </p>
        )}

        <ContentDisclaimer contentClass="ai_generated" />

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {onFollowUp && (
            <Button variant="outline" size="sm" onClick={onFollowUp}>
              <MessageSquarePlusIcon aria-hidden />
              Ask a follow-up
            </Button>
          )}
        </div>
      </article>

      {groups.length > 0 && (
        <aside aria-label="Sources" className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
            Sources ({cited.length})
          </h2>
          {groups.map((group) => (
            <div key={group.key} className="space-y-2" data-testid={`source-group-${group.key}`}>
              <h3 className="text-xs font-semibold text-warm-ink">{group.label}</h3>
              <ul className="space-y-2">
                {group.sources.map((s) => (
                  <li
                    key={s.sourceId}
                    className="rounded-lg border border-warm-ink/10 bg-warm-surface p-3"
                  >
                    <div className="flex gap-2">
                      <span className="font-mono text-xs font-semibold text-warm-accent-deep">
                        {numbers.get(s.sourceId)}
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          href={readerPinpointHref(s)}
                          className="line-clamp-2 text-sm font-medium text-warm-ink hover:underline"
                        >
                          {s.title}
                        </Link>
                        <p className="text-xs text-warm-ink-mid">
                          {[s.citation ?? s.grNo, formatCourt(s.court), formatSourceDate(s.date)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
