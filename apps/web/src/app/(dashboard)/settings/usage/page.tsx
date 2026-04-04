'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  GiftIcon,
  InfinityIcon,
  TrendingUpIcon,
  CalendarIcon,
  AlertTriangleIcon,
} from 'lucide-react';

import { useQuotaUsage } from '@/features/billing/hooks/use-quotas';
import { useSubscription } from '@/features/billing/hooks/use-subscription';
import {
  PLAN_LABELS,
  ENTITLEMENT_LABELS,
  quotaPercent,
  isNearLimit,
  isUnlimited,
  type QuotaUsageItem,
  type ActiveBonus,
} from '@/features/billing/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function UsagePage() {
  const { data: usageData, isLoading: usageLoading, error: usageError } = useQuotaUsage();
  const { data: subscription, isLoading: subLoading } = useSubscription();

  const isLoading = usageLoading || subLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="link" asChild className="px-0 text-muted-foreground">
          <Link href="/settings">
            <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
            Settings
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Usage &amp; Quotas</h1>
      </div>

      {usageError && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load usage data. Please try again later.</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <UsageSkeleton />
      ) : (
        <>
          {/* Plan & Billing Period Summary */}
          <PlanSummaryCard
            planCode={subscription?.planCode ?? 'free'}
            billingPeriodStart={usageData?.billingPeriodStart ?? null}
            billingPeriodEnd={usageData?.billingPeriodEnd ?? null}
            status={subscription?.status ?? 'active'}
          />

          {/* Quota Cards Grid */}
          {usageData && <QuotaGrid quotas={usageData.quotas} />}

          {/* Active Bonuses */}
          {usageData && usageData.activeBonuses.length > 0 && (
            <ActiveBonusesSection bonuses={usageData.activeBonuses} />
          )}

          {/* Upgrade CTA */}
          {subscription?.planCode &&
            ['free', 'edu'].includes(subscription.planCode) && (
              <UpgradeCard currentPlan={subscription.planCode} />
            )}
        </>
      )}
    </div>
  );
}

// ─── Plan Summary Card ──────────────────────────────────

function PlanSummaryCard({
  planCode,
  billingPeriodStart,
  billingPeriodEnd,
  status,
}: {
  planCode: string;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  status: string;
}) {
  const planName = PLAN_LABELS[planCode] ?? planCode;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium">Current Plan</p>
            <p className="text-lg font-bold">{planName}</p>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-10 sm:block" />

        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Billing Period</p>
            <p className="text-sm text-muted-foreground">
              {billingPeriodStart && billingPeriodEnd
                ? `${formatDate(billingPeriodStart)} - ${formatDate(billingPeriodEnd)}`
                : 'No active billing period'}
            </p>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-10 sm:block" />

        <Badge variant={status === 'active' ? 'default' : 'secondary'} className="capitalize">
          {status.replace(/_/g, ' ')}
        </Badge>

        <div className="ml-auto">
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/billing">
              Manage Plan
              <ArrowUpRightIcon className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Quota Grid ─────────────────────────────────────────

function QuotaGrid({ quotas }: { quotas: Record<string, QuotaUsageItem> }) {
  const sortedEntries = useMemo(() => {
    return Object.entries(quotas).sort(([a], [b]) => {
      // Show limited quotas first, unlimited last
      const aUnlimited = isUnlimited(quotas[a]!);
      const bUnlimited = isUnlimited(quotas[b]!);
      if (aUnlimited !== bUnlimited) return aUnlimited ? 1 : -1;
      // Among limited, show near-limit first
      const aNear = isNearLimit(quotas[a]!);
      const bNear = isNearLimit(quotas[b]!);
      if (aNear !== bNear) return aNear ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [quotas]);

  if (sortedEntries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No quota data available for your current plan.
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Usage Overview</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedEntries.map(([key, item]) => (
          <QuotaCard key={key} entitlementKey={key} item={item} />
        ))}
      </div>
    </div>
  );
}

function QuotaCard({
  entitlementKey,
  item,
}: {
  entitlementKey: string;
  item: QuotaUsageItem;
}) {
  const label = ENTITLEMENT_LABELS[entitlementKey] ?? formatEntitlementKey(entitlementKey);
  const unlimited = isUnlimited(item);
  const nearLimit = isNearLimit(item);
  const percent = quotaPercent(item);

  return (
    <Card className={nearLimit && !unlimited ? 'border-amber-300 dark:border-amber-700' : ''}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{label}</p>
          {nearLimit && !unlimited && (
            <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
          )}
        </div>

        {unlimited ? (
          <div className="flex items-center gap-2">
            <InfinityIcon className="h-5 w-5 text-primary" />
            <span className="text-sm text-muted-foreground">Unlimited</span>
            {item.used > 0 && (
              <span className="ml-auto text-sm font-medium">{item.used.toLocaleString()} used</span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold">{item.used.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">
                / {item.limit.toLocaleString()}
              </span>
            </div>

            <Progress
              value={percent}
              className={
                percent >= 90
                  ? '[&>[data-slot=progress-indicator]]:bg-red-500'
                  : percent >= 80
                    ? '[&>[data-slot=progress-indicator]]:bg-amber-500'
                    : ''
              }
            />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{item.remaining.toLocaleString()} remaining</span>
              {item.bonusAmount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  +{item.bonusAmount} bonus
                </Badge>
              )}
            </div>

            {item.resetsAt && (
              <p className="text-xs text-muted-foreground">
                Resets {formatDate(item.resetsAt)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Active Bonuses Section ─────────────────────────────

function ActiveBonusesSection({ bonuses }: { bonuses: ActiveBonus[] }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
        <GiftIcon className="h-5 w-5 text-primary" />
        Active Bonuses
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {bonuses.map((bonus) => (
          <Card key={bonus.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {ENTITLEMENT_LABELS[bonus.entitlementKey] ??
                    formatEntitlementKey(bonus.entitlementKey)}
                </p>
                <p className="text-xs text-muted-foreground">{bonus.reason}</p>
                {bonus.expiresAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expires {formatDate(bonus.expiresAt)}
                  </p>
                )}
              </div>
              <Badge variant="secondary">
                {bonus.numericValue !== null
                  ? `+${bonus.numericValue}`
                  : bonus.booleanValue
                    ? 'Enabled'
                    : 'Active'}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Upgrade CTA ────────────────────────────────────────

function UpgradeCard({ currentPlan }: { currentPlan: string }) {
  const suggestedPlan = currentPlan === 'free' ? 'Edu' : 'Pro';

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex-1">
          <p className="font-medium">Need more capacity?</p>
          <p className="text-sm text-muted-foreground">
            Upgrade to {suggestedPlan} for higher quotas and additional features.
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/billing">
            Upgrade to {suggestedPlan}
            <ArrowUpRightIcon className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton ───────────────────────────────────────────

function UsageSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-6 w-16" />
        </CardContent>
      </Card>
      <div>
        <Skeleton className="mb-3 h-6 w-36" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatEntitlementKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
