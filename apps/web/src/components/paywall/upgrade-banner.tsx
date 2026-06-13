'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { LockIcon, SparklesIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useTrack } from '@/hooks/use-analytics';
import { useCanAccessPaidFeature } from '@/hooks/useCanAccessPaidFeature';
import { ApiClientError } from '@/lib/api-client';

export type PaywallCorpus = 'documents' | 'digests' | 'derivatives' | 'search';

export interface PaywallDetail402 {
  corpus: 'documents' | 'digests' | 'derivatives';
  previewItemId?: string;
  message?: string;
}

export interface PaywallSearch403 {
  used: number;
  limit: number;
  resetsAt: string;
}

export function extractPaywall402(error: unknown): PaywallDetail402 | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.statusCode !== 402) return null;
  const body = (error.body ?? {}) as Record<string, unknown>;
  if (body['code'] !== 'subscription_required') return null;
  const corpus = body['corpus'];
  if (corpus !== 'documents' && corpus !== 'digests' && corpus !== 'derivatives') {
    return null;
  }
  const detail: PaywallDetail402 = { corpus };
  if (typeof body['previewItemId'] === 'string') {
    detail.previewItemId = body['previewItemId'];
  }
  if (typeof body['message'] === 'string') {
    detail.message = body['message'];
  }
  return detail;
}

export function extractSearchQuota403(error: unknown): PaywallSearch403 | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.statusCode !== 403) return null;
  const body = (error.body ?? {}) as Record<string, unknown>;
  const quota = body['quota'];
  if (!quota || typeof quota !== 'object') return null;
  const q = quota as Record<string, unknown>;
  if (
    typeof q['used'] !== 'number' ||
    typeof q['limit'] !== 'number' ||
    typeof q['resetsAt'] !== 'string'
  ) {
    return null;
  }
  return {
    used: q['used'],
    limit: q['limit'],
    resetsAt: q['resetsAt'],
  };
}

const CORPUS_LABELS: Record<PaywallCorpus, { singular: string; plural: string }> = {
  documents: { singular: 'document', plural: 'documents' },
  digests: { singular: 'digest', plural: 'digests' },
  derivatives: { singular: 'item', plural: 'items' },
  search: { singular: 'search', plural: 'searches' },
};

interface CommonProps {
  corpus: PaywallCorpus;
  /** Identifier of the surface (route or page name) for analytics */
  surface?: string;
}

interface InlineProps extends CommonProps {
  variant: 'inline';
  lockedCount: number;
}

interface ModalProps extends CommonProps {
  variant: 'modal';
  previewItemId?: string | undefined;
  /** Pre-built href for the "Read free preview instead" CTA */
  previewHref?: string | undefined;
  message?: string | undefined;
  quota?: { used: number; limit: number; resetsAt: string } | undefined;
}

export type UpgradeBannerProps = InlineProps | ModalProps;

function formatResetsAt(resetsAt: string): string {
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleString();
}

export function UpgradeBanner(props: UpgradeBannerProps) {
  const track = useTrack();
  const { canAccess, reason } = useCanAccessPaidFeature();

  useEffect(() => {
    // Defense in depth: even if a parent forgot to gate, admins should
    // never see the upsell, so don't fire the analytics event either.
    if (canAccess) return;
    track('paywall_shown', {
      corpus: props.corpus,
      variant: props.variant,
      surface: props.surface ?? null,
      // Differentiate organic upsells (`free`) from the rare race where
      // a parent rendered the banner before the subscription resolved.
      access_reason: reason,
    });
    // Track once per mount keyed on identity of corpus/variant/surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  // Hard gate: platform admins (and any genuinely-paid user a parent
  // misrendered to) get nothing. The 'loading' branch falls through and
  // continues to render the banner — that branch only happens for non-
  // admin users whose subscription query is in flight, and the existing
  // surfaces already render the banner from a backend signal that has
  // also already resolved by that point.
  if (canAccess) return null;

  if (props.variant === 'inline') {
    return <InlineBanner {...props} />;
  }
  return <ModalBanner {...props} />;
}

function InlineBanner({ corpus, lockedCount }: InlineProps) {
  const label = CORPUS_LABELS[corpus];
  const safeCount = Math.max(0, Number.isFinite(lockedCount) ? lockedCount : 0);
  const noun = safeCount === 1 ? label.singular : label.plural;

  return (
    <Card
      data-testid="upgrade-banner-inline"
      className="border-warm-accent/40 bg-warm-cream-3"
    >
      <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warm-accent/15 text-warm-accent-deep">
            <LockIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-warm-ink">
              {safeCount > 0
                ? `${safeCount} more ${noun} available with a paid plan`
                : `More ${label.plural} available with a paid plan`}
            </p>
            <p className="mt-0.5 text-xs text-warm-ink-mid">
              Free plan preview shows a sample. Upgrade to unlock the full catalog.
            </p>
          </div>
        </div>
        <Link
          href="/pricing"
          className="inline-flex h-9 flex-none items-center justify-center rounded-full bg-warm-ink px-4 text-xs font-semibold text-warm-cream transition hover:bg-warm-ink-soft"
        >
          {safeCount > 0 ? `View ${safeCount} more — Upgrade` : 'Upgrade'}
        </Link>
      </CardContent>
    </Card>
  );
}

function ModalBanner({
  corpus,
  previewItemId,
  previewHref,
  message,
  quota,
}: ModalProps) {
  const isSearch = corpus === 'search';
  const heading = isSearch
    ? 'Daily search limit reached'
    : 'Upgrade to view this content';

  const description = (() => {
    if (isSearch && quota) {
      return `Used ${quota.used} of ${quota.limit} searches today — resets ${formatResetsAt(
        quota.resetsAt,
      )}.`;
    }
    if (message) return message;
    const noun =
      corpus === 'documents'
        ? 'document'
        : corpus === 'digests'
          ? 'digest'
          : 'item';
    return `Your free plan includes a preview only. Upgrade to read the full ${noun}.`;
  })();

  return (
    <div
      data-testid="upgrade-banner-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-banner-modal-heading"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-warm-ink/40 p-4 backdrop-blur-sm"
    >
      <Card className="w-full max-w-md border-warm-accent/30 bg-warm-surface shadow-2xl">
        <CardContent className="space-y-5 p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-warm-accent-soft text-warm-accent-deep">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <h2
              id="upgrade-banner-modal-heading"
              className="text-lg font-semibold text-warm-ink"
            >
              {heading}
            </h2>
          </div>

          <p className="text-sm text-warm-ink-mid">{description}</p>

          <div className="flex flex-col gap-2">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center justify-center rounded-full bg-warm-ink px-6 text-sm font-semibold text-warm-cream transition hover:bg-warm-ink-soft"
            >
              View plans &amp; upgrade
            </Link>
            {!isSearch && previewItemId && previewHref && (
              <Link
                href={previewHref}
                className="inline-flex h-11 items-center justify-center rounded-full border border-warm-ink/15 bg-warm-cream-2 px-6 text-sm font-semibold text-warm-ink transition hover:bg-warm-cream-3"
              >
                Read free preview instead
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
