'use client';

import Link from 'next/link';
import {
  AlertCircleIcon,
  CalendarClockIcon,
  CloudOffIcon,
  LockIcon,
  SearchXIcon,
} from 'lucide-react';

import { UpgradeBanner } from '@/components/paywall/upgrade-banner';
import { Button } from '@/components/ui/button';
import { abstentionCopy } from '@/features/search/components/abstention-copy';

import type { DeepResearchError } from '../lib/api';

function Shell({
  icon,
  title,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-xl border border-warm-ink/10 bg-warm-surface p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warm-accent-soft text-warm-accent-deep">
          {icon}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="text-base font-semibold text-warm-ink">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

const pricingLinkClass =
  'inline-flex h-9 items-center justify-center rounded-full bg-warm-ink px-4 text-xs font-semibold text-warm-cream transition hover:bg-warm-ink-soft';

function formatReset(resetAt: string | undefined): string | null {
  if (!resetAt) return null;
  const d = new Date(resetAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Terminal failure of a run (HTTP refusal or SSE `error`). */
export function DeepResearchErrorCard({
  error,
  onRetry,
}: {
  error: DeepResearchError;
  onRetry?: () => void;
}) {
  switch (error.code) {
    case 'subscription_required':
      return (
        <>
          {/* The shared paywall surface (analytics + admin short-circuit). */}
          <UpgradeBanner
            variant="modal"
            corpus="derivatives"
            surface="research"
            message="Deep Research is included on paid plans. Upgrade to run multi-query research answers verified against their sources."
          />
          <Shell
            testId="dr-error-subscription"
            icon={<LockIcon className="size-4" aria-hidden />}
            title="Deep Research is a paid feature"
          >
            <p className="text-sm text-warm-ink-mid">
              Your current plan doesn’t include Deep Research.
            </p>
            <Link href="/pricing" className={pricingLinkClass}>
              View plans &amp; upgrade
            </Link>
          </Shell>
        </>
      );
    case 'quota_exceeded': {
      const reset = formatReset(error.resetAt);
      return (
        <Shell
          testId="dr-error-quota"
          icon={<CalendarClockIcon className="size-4" aria-hidden />}
          title="You’ve used this month’s Deep Research runs"
        >
          <p className="text-sm text-warm-ink-mid">
            {error.limit !== undefined
              ? `All ${error.limit} runs on your plan are used. `
              : 'Your monthly allowance is used up. '}
            {reset ? `Your allowance resets on ${reset}.` : 'Your allowance resets next month.'}
          </p>
          <Link href="/pricing" className={pricingLinkClass}>
            Upgrade for more runs
          </Link>
        </Shell>
      );
    }
    case 'budget_exhausted':
      return (
        <Shell
          testId="dr-error-budget"
          icon={<CloudOffIcon className="size-4" aria-hidden />}
          title="Deep Research is temporarily unavailable"
        >
          <p className="text-sm text-warm-ink-mid">
            We’ve paused Deep Research for a little while. This run wasn’t counted against your
            monthly allowance — please try again later.
          </p>
        </Shell>
      );
    default:
      return (
        <Shell
          testId="dr-error-generic"
          icon={<AlertCircleIcon className="size-4" aria-hidden />}
          title="Deep Research couldn’t finish"
        >
          <p className="text-sm text-warm-ink-mid">
            {error.message || 'Something went wrong. Please try again.'}
          </p>
          {onRetry && error.code !== 'unauthorized' && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </Shell>
      );
  }
}

/** The pipeline found too little authority and refused to write an answer. */
export function AbstainedCard({ reason }: { reason?: string | null | undefined }) {
  return (
    <Shell
      testId="dr-abstained"
      icon={<SearchXIcon className="size-4" aria-hidden />}
      title="Not enough authority found"
    >
      <p className="text-sm text-warm-ink-mid">
        {abstentionCopy(reason)} Rather than guess, Deep Research only answers when it can quote
        its sources. This run wasn’t counted against your monthly allowance.
      </p>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-warm-ink-faint">Tips</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-warm-ink-mid">
          <li>Name the law, article or doctrine (e.g. “Art. 1318, Civil Code”).</li>
          <li>Use Philippine legal terms rather than general wording.</li>
          <li>Ask one question at a time; split compound questions.</li>
          <li>Add the context that matters: the parties, the court, the period.</li>
        </ul>
      </div>
    </Shell>
  );
}
