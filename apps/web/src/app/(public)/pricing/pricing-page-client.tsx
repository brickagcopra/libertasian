'use client';

import { Fragment, useState, useMemo } from 'react';
import Link from 'next/link';
import { TagIcon, ClockIcon } from 'lucide-react';

import { usePlans, useActivePromotions } from '@/features/billing/hooks/use-plans';
import { useSubscription } from '@/features/billing/hooks/use-subscription';
import { useAuthStore } from '@/stores/auth-store';
import {
  PLANS,
  getPlanPrice,
  formatPHP,
  getPromotionDiscountLabel,
  planDetailToPlanInfo,
} from '@/features/billing/types';
import type {
  PlanDetail,
  PlanInfo,
  ActivePromotionForPricing,
  PlanEntitlementDetail,
} from '@/features/billing/types';

// ─── Feature Categories (presentation concern) ──────────

const FEATURE_CATEGORIES: Record<string, string> = {
  searchQueries: 'Search & Research',
  aiAnswers: 'Search & Research',
  aiAnswerModes: 'Search & Research',
  publicCorpusAccess: 'Search & Research',
  digestsPerMonth: 'Digests & Documents',
  cameraScansPerMonth: 'Digests & Documents',
  cameraScanDigests: 'Digests & Documents',
  documentUploads: 'Digests & Documents',
  memoDraftingPerMonth: 'Digests & Documents',
  memoDrafting: 'Digests & Documents',
  codalReader: 'Study Tools',
  offlineReading: 'Study Tools',
  offlineMobileReading: 'Study Tools',
  flashcardGeneration: 'Study Tools',
  studyProgressTracking: 'Study Tools',
  reviewerPacks: 'Study Tools',
  caseComparisonPerMonth: 'Practice & Collaboration',
  maxMatters: 'Practice & Collaboration',
  activeMatters: 'Practice & Collaboration',
  teamCollaboration: 'Practice & Collaboration',
  teamWorkspace: 'Practice & Collaboration',
  roleBasedAccess: 'Practice & Collaboration',
  auditLogs: 'Practice & Collaboration',
  maxApiKeys: 'Practice & Collaboration',
  apiKeys: 'Practice & Collaboration',
  editorialTools: 'Practice & Collaboration',
  maxResearchWorkspaces: 'Practice & Collaboration',
  pleadingAssistancePerMonth: 'Practice & Collaboration',
  timelineGenerationPerMonth: 'Practice & Collaboration',
  hearingPrepPerMonth: 'Practice & Collaboration',
  contradictionDetectionPerMonth: 'Practice & Collaboration',
  dedicatedSupport: 'Practice & Collaboration',
  customIntegrations: 'Practice & Collaboration',
};

const CATEGORY_ORDER = [
  'Search & Research',
  'Digests & Documents',
  'Study Tools',
  'Practice & Collaboration',
];

/** Convert a camelCase entitlement key to a display label */
function formatEntitlementKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/Per Month$/, '(per month)')
    .trim();
}

// ─── Props ───────────────────────────────────────────────

interface PricingPageClientProps {
  initialPlans?: PlanDetail[];
  dynamicEnabled: boolean;
  fetchError: boolean;
}

// ─── Auth-aware CTA resolution ────────────────────────────

export interface PlanCtaContext {
  isAuthenticated: boolean;
  /**
   * Signed-in user's current plan code. `null` when signed out or while the
   * subscription is still resolving (unknown — treat as "not current plan").
   */
  currentPlanCode: string | null;
}

/**
 * Resolve where a plan card CTA should point:
 * - Signed out → `/register`, carrying `plan`/`coupon` so the checkout intent
 *   survives signup. (NOT `/auth/callback` — that route discards these params
 *   and bounces authenticated users to /search.)
 * - Signed in → `/settings/billing`, which owns the real checkout flow; the
 *   `plan` param preselects the plan in the Choose-a-Plan dialog.
 */
export function buildPlanCtaHref(
  planCode: string,
  isFree: boolean,
  couponCode: string,
  ctx: PlanCtaContext,
): string {
  const params = new URLSearchParams();
  if (!isFree) params.set('plan', planCode);
  const coupon = couponCode.trim();
  if (coupon) params.set('coupon', coupon);
  const base = ctx.isAuthenticated ? '/settings/billing' : '/register';
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function PlanCardCta({
  planCode,
  isFree,
  couponCode,
  ctx,
  label,
  className,
}: {
  planCode: string;
  isFree: boolean;
  couponCode: string;
  ctx: PlanCtaContext;
  label: string;
  className: string;
}) {
  // A signed-in user already on the free plan has no action to take on the
  // free card — show a disabled "Current plan" state instead of a dead link.
  if (isFree && ctx.isAuthenticated && ctx.currentPlanCode === 'free') {
    return (
      <button
        type="button"
        disabled
        className="mt-6 block w-full cursor-not-allowed rounded-full bg-warm-cream-2 px-4 py-2.5 text-center text-sm font-semibold text-warm-ink-faint"
      >
        Current plan
      </button>
    );
  }

  return (
    <Link href={buildPlanCtaHref(planCode, isFree, couponCode, ctx)} className={className}>
      {label}
    </Link>
  );
}

// ─── Main Client Component ───────────────────────────────

export function PricingPageClient({
  initialPlans,
  dynamicEnabled,
  fetchError,
}: PricingPageClientProps) {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [couponCode, setCouponCode] = useState('');

  const { data: apiPlans, isLoading: plansLoading } = usePlans(
    dynamicEnabled ? initialPlans : undefined,
  );
  const { data: promotions } = useActivePromotions();

  // Auth-aware CTAs: signed-in users go to the real checkout in billing
  // settings, signed-out users go through /register with plan intent attached.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: subscription } = useSubscription({ enabled: isAuthenticated });
  const ctaContext: PlanCtaContext = {
    isAuthenticated,
    currentPlanCode: isAuthenticated
      ? subscription === undefined
        ? null // still resolving — don't claim "Current plan" yet
        : (subscription?.planCode ?? 'free') // 404/null subscription = free tier
      : null,
  };

  // Resolve plans: API-driven or fallback (must be called unconditionally — Rules of Hooks)
  const { plans, isFromApi } = useMemo(() => {
    if (apiPlans) {
      const sorted = [...apiPlans].sort((a, b) => a.displayOrder - b.displayOrder);
      return { plans: sorted, isFromApi: true };
    }
    return { plans: null, isFromApi: false };
  }, [apiPlans]);

  const activePromotions = promotions ?? [];

  // Kill switch: force static fallback
  if (!dynamicEnabled) {
    return (
      <PricingShell
        billingPeriod={billingPeriod}
        setBillingPeriod={setBillingPeriod}
        promotions={promotions ?? []}
        couponCode={couponCode}
        setCouponCode={setCouponCode}
      >
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLANS.map((plan) => (
            <StaticPlanCard
              key={plan.code}
              plan={plan}
              billingPeriod={billingPeriod}
              couponCode={couponCode}
              ctaContext={ctaContext}
            />
          ))}
        </div>
        <CouponCodeInput couponCode={couponCode} onChange={setCouponCode} />
        <StaticFeatureComparison />
      </PricingShell>
    );
  }

  // Error fallback: if API failed at build time and no data available
  if (fetchError && !plans) {
    // TODO: remove fallback after one clean week in prod
    return (
      <PricingShell
        billingPeriod={billingPeriod}
        setBillingPeriod={setBillingPeriod}
        promotions={activePromotions}
        couponCode={couponCode}
        setCouponCode={setCouponCode}
      >
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLANS.map((plan) => (
            <StaticPlanCard
              key={plan.code}
              plan={plan}
              billingPeriod={billingPeriod}
              couponCode={couponCode}
              ctaContext={ctaContext}
            />
          ))}
        </div>
        <CouponCodeInput couponCode={couponCode} onChange={setCouponCode} />
        <StaticFeatureComparison />
      </PricingShell>
    );
  }

  // Empty state: dynamic enabled, API succeeded, but no plans configured
  if (isFromApi && plans && plans.length === 0) {
    return (
      <PricingShell
        billingPeriod={billingPeriod}
        setBillingPeriod={setBillingPeriod}
        promotions={activePromotions}
        couponCode={couponCode}
        setCouponCode={setCouponCode}
      >
        <div className="mt-12 flex justify-center">
          <div
            className="max-w-md rounded-2xl border p-8 text-center"
            style={{
              background: 'var(--warm-accent-soft)',
              borderColor: 'var(--warm-accent)',
            }}
          >
            <h3 className="text-lg font-semibold text-warm-ink">
              Pricing temporarily unavailable
            </h3>
            <p className="mt-2 text-sm text-warm-ink-mid">
              Please contact{' '}
              <a
                href="mailto:support@libertasian.com"
                className="underline hover:text-warm-accent-deep"
              >
                support@libertasian.com
              </a>{' '}
              for plan information.
            </p>
          </div>
        </div>
      </PricingShell>
    );
  }

  return (
    <PricingShell
      billingPeriod={billingPeriod}
      setBillingPeriod={setBillingPeriod}
      promotions={activePromotions}
      couponCode={couponCode}
      setCouponCode={setCouponCode}
    >
      {/* Plan Cards */}
      {plansLoading ? (
        <PlanCardsSkeleton />
      ) : isFromApi && plans ? (
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {plans.map((plan) => (
            <DynamicPlanCard
              key={plan.id}
              plan={plan}
              billingPeriod={billingPeriod}
              promotions={activePromotions}
              couponCode={couponCode}
              ctaContext={ctaContext}
            />
          ))}
        </div>
      ) : (
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLANS.map((plan) => (
            <StaticPlanCard
              key={plan.code}
              plan={plan}
              billingPeriod={billingPeriod}
              couponCode={couponCode}
              ctaContext={ctaContext}
            />
          ))}
        </div>
      )}

      {/* Coupon Code Input */}
      <CouponCodeInput couponCode={couponCode} onChange={setCouponCode} />

      {/* Feature Comparison */}
      {isFromApi && plans ? (
        <DynamicFeatureComparison plans={plans} />
      ) : (
        <StaticFeatureComparison />
      )}
    </PricingShell>
  );
}

// ─── Pricing Shell (Header + Toggle wrapper) ─────────────

function PricingShell({
  billingPeriod,
  setBillingPeriod,
  promotions,
  couponCode,
  setCouponCode,
  children,
}: {
  billingPeriod: 'monthly' | 'annual';
  setBillingPeriod: (p: 'monthly' | 'annual') => void;
  promotions: ActivePromotionForPricing[];
  couponCode: string;
  setCouponCode: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-16">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Plans for every legal professional
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          From law students to full-service firms. AI-powered Philippine legal research
          at your fingertips.
        </p>
      </div>

      {/* Active Promotions Banner */}
      {promotions.length > 0 && (
        <PromotionBanner promotions={promotions} billingPeriod={billingPeriod} />
      )}

      {/* Billing Toggle — sticky so it stays in view while scrolling the
          comparison table further down the page. */}
      <div
        className="sticky top-16 z-20 -mx-6 mt-10 flex items-center justify-center gap-3 px-6 py-3 backdrop-blur"
        style={{ background: 'rgba(246, 241, 232, 0.9)' }}
      >
        <button
          onClick={() => setBillingPeriod('monthly')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            billingPeriod === 'monthly'
              ? 'bg-warm-ink text-warm-cream'
              : 'bg-warm-cream-2 text-warm-ink-mid hover:bg-warm-cream-3'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingPeriod('annual')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            billingPeriod === 'annual'
              ? 'bg-warm-ink text-warm-cream'
              : 'bg-warm-cream-2 text-warm-ink-mid hover:bg-warm-cream-3'
          }`}
        >
          Annual
          <span className="ml-1.5 text-xs text-warm-accent-deep">(Save ~17%)</span>
        </button>
      </div>

      {children}
    </div>
  );
}

// ─── Promotion Banner ─────────────────────────────────────

function PromotionBanner({
  promotions,
  billingPeriod,
}: {
  promotions: ActivePromotionForPricing[];
  billingPeriod: 'monthly' | 'annual';
}) {
  return (
    <div className="mt-8 space-y-2">
      {promotions.map((promo) => {
        const discountLabel = getPromotionDiscountLabel(promo, billingPeriod);
        if (!discountLabel) return null;

        return (
          <div
            key={promo.id}
            className="flex items-center justify-center gap-3 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-3 border border-green-200"
          >
            <TagIcon className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium text-green-800">
              {promo.name}: <span className="font-bold">{discountLabel}</span>
            </span>
            {promo.description && (
              <span className="text-xs text-green-600">&mdash; {promo.description}</span>
            )}
            {promo.endsAt && (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <ClockIcon className="h-3 w-3" />
                Ends {new Date(promo.endsAt).toLocaleDateString('en-PH', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Dynamic Plan Card (API-driven) ───────────────────────

/** Resolve card accent classes from highlightColor field */
function getHighlightClasses(color: string | null | undefined): {
  border: string;
  cta: string;
  badge: string;
} {
  switch (color) {
    case 'emerald':
      return {
        border: 'border-emerald-600 ring-2 ring-emerald-600',
        cta: 'bg-emerald-600 text-white hover:bg-emerald-700',
        badge: 'bg-emerald-600',
      };
    case 'amber':
      return {
        border: 'border-amber-600 ring-2 ring-amber-600',
        cta: 'bg-amber-600 text-white hover:bg-amber-700',
        badge: 'bg-amber-600',
      };
    case 'primary':
    default:
      return {
        border: 'border-gray-900 ring-2 ring-gray-900',
        cta: 'bg-gray-900 text-white hover:bg-gray-800',
        badge: 'bg-gray-900',
      };
  }
}

function DynamicPlanCard({
  plan,
  billingPeriod,
  promotions,
  couponCode,
  ctaContext,
}: {
  plan: PlanDetail;
  billingPeriod: 'monthly' | 'annual';
  promotions: ActivePromotionForPricing[];
  couponCode: string;
  ctaContext: PlanCtaContext;
}) {
  const priceCentavos = getPlanPrice(plan, billingPeriod);
  const isFree = plan.code === 'free';
  const isHighlight = plan.isFeatured;
  const highlightClasses = getHighlightClasses(plan.highlightColor);

  // Find applicable promotion discount label
  const firstPromo = promotions[0];
  const promoLabel = firstPromo
    ? getPromotionDiscountLabel(firstPromo, billingPeriod)
    : null;

  // Build feature list from entitlements. Drop entitlements that the
  // comparison table renders as "not included" so the card and table agree:
  //   - numeric === 0    (e.g. "0 active matters")
  //   - boolean === false (e.g. team collaboration off for this tier)
  // Otherwise a false boolean renders with a green check, making a premium
  // feature look included when the table correctly shows "—".
  const features = plan.entitlements
    .filter(
      (e) =>
        e.description &&
        !(e.valueType === 'numeric' && e.numericValue === 0) &&
        !(e.valueType === 'boolean' && e.booleanValue === false),
    )
    .map((e) => e.description as string);

  // Resolve CTA text
  const ctaText = plan.ctaText
    ?? (isFree ? 'Get Started Free' : plan.code === 'enterprise' ? 'Contact Sales' : 'Start Now');

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        isHighlight ? highlightClasses.border : 'border-warm-ink/10 bg-warm-surface'
      }`}
    >
      {isHighlight && (
        <span className={`absolute -top-3 left-1/2 -translate-x-1/2 rounded-full ${highlightClasses.badge} px-3 py-1 text-xs font-semibold text-white`}>
          {plan.featuredLabel ?? 'Most Popular'}
        </span>
      )}

      {promoLabel && !isFree && (
        <span className="absolute -top-3 right-3 rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">
          {promoLabel}
        </span>
      )}

      <h3 className="text-lg font-semibold text-gray-900">
        {plan.displayName || plan.name}
      </h3>

      {plan.description && (
        <p className="mt-1 text-xs text-gray-500">{plan.description}</p>
      )}

      <div className="mt-4">
        <span
          className="font-medium text-warm-ink"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 40px)',
            lineHeight: 1.1,
          }}
        >
          {formatPHP(priceCentavos)}
        </span>
        {priceCentavos > 0 && (
          <span className="ml-1 text-sm text-gray-500">
            /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
          </span>
        )}
        {plan.code === 'team' && plan.defaultSeats > 1 && (
          <span className="mt-1 block text-xs text-gray-400">
            per seat, min {plan.defaultSeats}
          </span>
        )}
      </div>

      {plan.trialEnabled && plan.trialDurationDays > 0 && (
        <p className="mt-1 text-xs font-medium text-blue-600">
          {plan.trialDurationDays}-day free trial
        </p>
      )}

      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <PlanCardCta
        planCode={plan.code}
        isFree={isFree}
        couponCode={couponCode}
        ctx={ctaContext}
        label={ctaText}
        className={`mt-6 block w-full rounded-full px-4 py-2.5 text-center text-sm font-semibold transition ${
          isHighlight
            ? highlightClasses.cta
            : 'bg-warm-ink text-warm-cream hover:bg-warm-ink-soft'
        }`}
      />
    </div>
  );
}

// ─── Static Plan Card (Hardcoded Fallback) ────────────────

function StaticPlanCard({
  plan,
  billingPeriod,
  couponCode,
  ctaContext,
}: {
  plan: PlanInfo;
  billingPeriod: 'monthly' | 'annual';
  couponCode: string;
  ctaContext: PlanCtaContext;
}) {
  const price = billingPeriod === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
  const isFree = plan.code === 'free';

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        plan.highlight
          ? 'border-warm-ink ring-2 ring-warm-ink bg-warm-surface'
          : 'border-warm-ink/10 bg-warm-surface'
      }`}
    >
      {plan.highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-warm-ink px-3 py-1 text-xs font-semibold text-warm-cream">
          Most Popular
        </span>
      )}

      <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>

      <div className="mt-4">
        <span
          className="font-medium text-warm-ink"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 40px)',
            lineHeight: 1.1,
          }}
        >
          {price === 0 ? 'Free' : `₱${price.toLocaleString()}`}
        </span>
        {price > 0 && (
          <span className="ml-1 text-sm text-gray-500">
            /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
          </span>
        )}
        {plan.code === 'team' && (
          <span className="mt-1 block text-xs text-gray-400">per seat, min 3</span>
        )}
      </div>

      <ul className="mt-6 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <PlanCardCta
        planCode={plan.code}
        isFree={isFree}
        couponCode={couponCode}
        ctx={ctaContext}
        label={
          isFree ? 'Get Started Free' : plan.code === 'enterprise' ? 'Contact Sales' : 'Start Now'
        }
        className={`mt-6 block w-full rounded-full px-4 py-2.5 text-center text-sm font-semibold transition ${
          plan.highlight
            ? 'bg-warm-accent text-warm-cream hover:bg-warm-accent-deep'
            : 'bg-warm-ink text-warm-cream hover:bg-warm-ink-soft'
        }`}
      />
    </div>
  );
}

// ─── Coupon Code Input ────────────────────────────────────

function CouponCodeInput({
  couponCode,
  onChange,
}: {
  couponCode: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-center">
      <div
        className="flex items-center gap-2 bg-warm-surface px-[18px] py-[14px]"
        style={{
          border: '1.5px solid var(--warm-ink)',
          borderRadius: 16,
        }}
      >
        <TagIcon className="h-4 w-4 text-warm-ink-mid" />
        <input
          type="text"
          value={couponCode}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Have a coupon code?"
          className="w-48 bg-transparent text-sm text-warm-ink placeholder:text-warm-ink-faint focus:outline-none"
          maxLength={50}
        />
        {couponCode && (
          <span className="text-xs text-warm-accent-deep">Applied at checkout</span>
        )}
      </div>
    </div>
  );
}

// ─── Plan Cards Skeleton ──────────────────────────────────

function PlanCardsSkeleton() {
  return (
    <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-warm-ink/10 bg-warm-surface p-6 animate-pulse"
        >
          <div className="h-5 w-16 rounded bg-gray-200" />
          <div className="mt-4 h-8 w-24 rounded bg-gray-200" />
          <div className="mt-6 flex-1 space-y-2.5">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-4 w-full rounded bg-gray-100" />
            ))}
          </div>
          <div className="mt-6 h-10 w-full rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

// ─── Dynamic Feature Comparison (from entitlements) ───────

function DynamicFeatureComparison({ plans }: { plans: PlanDetail[] }) {
  const comparison = useMemo(() => {
    // Collect all unique entitlement keys across plans
    const allKeys = new Set<string>();
    for (const plan of plans) {
      for (const e of plan.entitlements) {
        allKeys.add(e.key);
      }
    }

    // Group by category
    const categories = new Map<string, { key: string; label: string }[]>();
    for (const key of allKeys) {
      const category = FEATURE_CATEGORIES[key] ?? 'Other';
      const label = formatEntitlementKey(key);
      const list = categories.get(category) ?? [];
      list.push({ key, label });
      categories.set(category, list);
    }

    // Sort categories by defined order, append "Other" at end if present
    const orderedCategories = CATEGORY_ORDER
      .filter((cat) => categories.has(cat))
      .map((cat) => ({
        category: cat,
        features: categories.get(cat)!,
      }));

    // Add "Other" category if it has entries
    const other = categories.get('Other');
    if (other && other.length > 0) {
      orderedCategories.push({ category: 'Other', features: other });
    }

    return orderedCategories;
  }, [plans]);

  return (
    <div className="mt-20">
      <h2 className="text-center text-2xl font-bold text-gray-900">
        Feature comparison
      </h2>
      <p className="mt-2 text-center text-sm text-gray-500">
        Everything you need to know about each plan.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-warm-cream-2 py-3 pr-4 pl-3 text-left text-sm font-medium text-gray-500">
                Feature
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  className={`px-4 py-3 text-center text-sm font-semibold ${
                    plan.isFeatured ? 'text-gray-900' : 'text-gray-700'
                  }`}
                >
                  {plan.displayName || plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.map((category) => (
              <Fragment key={category.category}>
                <tr>
                  <td
                    colSpan={plans.length + 1}
                    className="pt-6 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
                  >
                    {category.category}
                  </td>
                </tr>
                {category.features.map((feature) => (
                  <tr key={feature.key} className="border-b border-gray-100">
                    <td className="sticky left-0 z-10 bg-warm-cream-2 py-2.5 pr-4 pl-3 text-sm text-gray-700">
                      {feature.label}
                    </td>
                    {plans.map((plan) => {
                      const entitlement = plan.entitlements.find(
                        (e) => e.key === feature.key,
                      );
                      return (
                        <td
                          key={plan.id}
                          className="px-4 py-2.5 text-center text-sm"
                        >
                          <EntitlementCell entitlement={entitlement ?? null} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntitlementCell({ entitlement }: { entitlement: PlanEntitlementDetail | null }) {
  if (!entitlement) {
    return <span className="text-gray-300">&mdash;</span>;
  }

  if (entitlement.valueType === 'unlimited') {
    return (
      <svg
        className="mx-auto h-4 w-4 text-green-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (entitlement.valueType === 'boolean') {
    if (entitlement.booleanValue) {
      return (
        <svg
          className="mx-auto h-4 w-4 text-green-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return <span className="text-gray-300">&mdash;</span>;
  }

  if (entitlement.valueType === 'numeric' && entitlement.numericValue !== null) {
    if (entitlement.numericValue === 0) return <span className="text-gray-300">&mdash;</span>;
    return <span className="text-gray-600">{entitlement.numericValue.toLocaleString()}</span>;
  }

  return <span className="text-gray-300">&mdash;</span>;
}

// ─── Static Feature Comparison (Hardcoded Fallback) ───────

const STATIC_COMPARISON_FEATURES = [
  {
    category: 'Search & Research',
    features: [
      { name: 'Public corpus access', free: true, edu: true, pro: true, team: true, enterprise: true },
      { name: 'Search queries', free: '50/day', edu: 'Unlimited', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
      { name: 'AI answers', free: '15 credits', edu: 'Plan-based', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
      { name: 'Answer modes (ALAC/IRAC/Bar)', free: false, edu: true, pro: true, team: true, enterprise: true },
    ],
  },
  {
    category: 'Digests & Documents',
    features: [
      { name: 'Case digest generation', free: false, edu: 'Plan-based', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
      { name: 'Camera scan digests', free: false, edu: '10/month', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
      { name: 'Document uploads', free: false, edu: false, pro: true, team: true, enterprise: true },
      { name: 'Memo drafting', free: false, edu: false, pro: true, team: true, enterprise: true },
    ],
  },
  {
    category: 'Study Tools',
    features: [
      { name: 'Codal reader', free: true, edu: true, pro: true, team: true, enterprise: true },
      { name: 'Offline mobile reading', free: false, edu: true, pro: true, team: true, enterprise: true },
      { name: 'Flashcard generation', free: false, edu: true, pro: true, team: true, enterprise: true },
      { name: 'Study progress tracking', free: false, edu: true, pro: true, team: true, enterprise: true },
      { name: 'Reviewer packs', free: false, edu: true, pro: true, team: true, enterprise: true },
    ],
  },
  {
    category: 'Practice & Collaboration',
    features: [
      { name: 'Case comparison', free: false, edu: false, pro: true, team: true, enterprise: true },
      { name: 'Active matters', free: false, edu: false, pro: '20', team: 'Unlimited', enterprise: 'Unlimited' },
      { name: 'Team workspace', free: false, edu: false, pro: false, team: true, enterprise: true },
      { name: 'Role-based access', free: false, edu: false, pro: false, team: true, enterprise: true },
      { name: 'API access', free: false, edu: false, pro: false, team: false, enterprise: '10 keys' },
    ],
  },
];

function StaticFeatureComparison() {
  return (
    <div className="mt-20">
      <h2 className="text-center text-2xl font-bold text-gray-900">
        Feature comparison
      </h2>
      <p className="mt-2 text-center text-sm text-gray-500">
        Everything you need to know about each plan.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-warm-cream-2 py-3 pr-4 pl-3 text-left text-sm font-medium text-gray-500">
                Feature
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan.code}
                  className={`px-4 py-3 text-center text-sm font-semibold ${
                    plan.highlight ? 'text-gray-900' : 'text-gray-700'
                  }`}
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATIC_COMPARISON_FEATURES.map((category) => (
              <Fragment key={category.category}>
                <tr>
                  <td
                    colSpan={6}
                    className="pt-6 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
                  >
                    {category.category}
                  </td>
                </tr>
                {category.features.map((feature) => (
                  <tr key={feature.name} className="border-b border-gray-100">
                    <td className="sticky left-0 z-10 bg-warm-cream-2 py-2.5 pr-4 pl-3 text-sm text-gray-700">
                      {feature.name}
                    </td>
                    {(['free', 'edu', 'pro', 'team', 'enterprise'] as const).map((planCode) => {
                      const value = feature[planCode];
                      return (
                        <td key={planCode} className="px-4 py-2.5 text-center text-sm">
                          {value === true ? (
                            <svg
                              className="mx-auto h-4 w-4 text-green-500"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : value === false ? (
                            <span className="text-gray-300">&mdash;</span>
                          ) : (
                            <span className="text-gray-600">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
