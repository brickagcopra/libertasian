'use client';

import { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Users,
  CreditCard,
  TicketIcon,
  MegaphoneIcon,
  ArrowUpDown,
  Percent,
  DollarSign,
  CalendarDays,
} from 'lucide-react';

import {
  useRevenueSummary,
  useRevenueTrend,
  useRevenueByPlan,
  useSubscriptionSummary,
  useSubscriptionTrend,
  useSubscriptionDistribution,
  useTrialSummary,
  usePaymentSummary,
  usePaymentTrend,
  useDiscountSummary,
  useTopCoupons,
  useTopPromotions,
  useCustomerSummary,
} from '@/features/billing/hooks/use-admin-reporting';
import type { DateRangeParams, TrendParams, TopItemsParams } from '@/features/billing/hooks/use-admin-reporting';
import type {
  RevenueTrendPoint,
  SubscriptionTrendPoint,
  PaymentTrendPoint,
  LabeledCount,
  RevenueByPlanItem,
  TopCouponItem,
  TopPromotionItem,
} from '@libertasian/types';

import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import dynamic from 'next/dynamic';
import type { LineChartPoint } from '@/components/charts/line-chart';
import type { BarChartItem } from '@/components/charts/bar-chart';

const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);
const BarChart = dynamic(
  () => import('@/components/charts/bar-chart').then((mod) => mod.BarChart),
  { ssr: false },
);

// ─── Helpers ────────────────────────────────────────────────

function formatPesos(pesos: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(pesos);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

function defaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Date Filter Controls ───────────────────────────────────

function DateFilters({
  params,
  onChange,
  showPeriod,
}: {
  params: TrendParams;
  onChange: (p: TrendParams) => void;
  showPeriod?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label className="text-xs">Start Date</Label>
        <Input
          type="date"
          className="h-8 w-40"
          value={params.startDate ?? defaultStartDate()}
          onChange={(e) => onChange({ ...params, startDate: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">End Date</Label>
        <Input
          type="date"
          className="h-8 w-40"
          value={params.endDate ?? defaultEndDate()}
          onChange={(e) => onChange({ ...params, endDate: e.target.value })}
        />
      </div>
      {showPeriod && (
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select
            value={params.period ?? 'day'}
            onValueChange={(v) =>
              onChange({ ...params, period: v as 'day' | 'week' | 'month' })
            }
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────

function MetricCard({
  label,
  value,
  subLabel,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  subLabel?: string;
  icon?: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon && <Icon className="size-4 text-muted-foreground" />}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend === 'up' && <TrendingUp className="size-4 text-green-500" />}
          {trend === 'down' && <TrendingDown className="size-4 text-red-500" />}
        </div>
        {subLabel && (
          <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Distribution Bar ───────────────────────────────────────

function DistributionList({
  items,
  total,
  label,
}: {
  items: LabeledCount[];
  total: number;
  label: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize">{item.label.replace(/_/g, ' ')}</span>
              <span className="font-medium">
                {item.count} ({total > 0 ? formatPercent(item.count / total) : '0%'})
              </span>
            </div>
            <Progress value={total > 0 ? (item.count / total) * 100 : 0} className="h-2" />
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">No data</p>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Revenue Tab
// ═══════════════════════════════════════════════════════════

function RevenueTab() {
  const [params, setParams] = useState<TrendParams>({});
  const { data: summary, isLoading: loadingSummary } = useRevenueSummary(params);
  const { data: trend, isLoading: loadingTrend } = useRevenueTrend(params);
  const { data: byPlan, isLoading: loadingByPlan } = useRevenueByPlan(params);

  const trendChartData: LineChartPoint[] = useMemo(() => {
    if (!trend?.data) return [];
    return trend.data.map((p: RevenueTrendPoint) => ({
      date: new Date(p.period),
      value: p.revenuePesos,
    }));
  }, [trend]);

  const planBarData: BarChartItem[] = useMemo(() => {
    if (!byPlan?.data) return [];
    return byPlan.data.map((p: RevenueByPlanItem) => ({
      label: p.planName || p.planCode,
      value: p.revenuePesos,
    }));
  }, [byPlan]);

  if (loadingSummary) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} showPeriod />

      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="MRR"
            value={formatPesos(summary.mrrPesos)}
            icon={DollarSign}
          />
          <MetricCard
            label="ARR"
            value={formatPesos(summary.arrPesos)}
            icon={TrendingUp}
          />
          <MetricCard
            label="ARPU"
            value={formatPesos(summary.arpuPesos)}
            subLabel={`${summary.activeSubscriptions} active subs`}
            icon={Users}
          />
          <MetricCard
            label="Net Revenue"
            value={formatPesos(summary.netRevenuePesos)}
            subLabel={`Discounts: ${formatPesos(summary.totalDiscountsPesos)}`}
            icon={CreditCard}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue Trend</CardTitle>
            <CardDescription>
              {params.period === 'month' ? 'Monthly' : params.period === 'week' ? 'Weekly' : 'Daily'} revenue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTrend ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : trendChartData.length > 0 ? (
              <LineChart data={trendChartData} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No trend data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue by Plan</CardTitle>
            <CardDescription>Total revenue per plan</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingByPlan ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : planBarData.length > 0 ? (
              <BarChart data={planBarData} width={500} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No plan data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {byPlan?.data && byPlan.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue by Plan (Detail)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Subscriptions</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPlan.data.map((p: RevenueByPlanItem) => (
                  <TableRow key={p.planCode}>
                    <TableCell className="font-medium">{p.planName || p.planCode}</TableCell>
                    <TableCell className="text-right">{formatPesos(p.revenuePesos)}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.paymentCount)}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.subscriptionCount)}</TableCell>
                    <TableCell className="text-right">
                      {byPlan.totalRevenuePesos > 0
                        ? formatPercent(p.revenuePesos / byPlan.totalRevenuePesos)
                        : '0%'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Subscriptions Tab
// ═══════════════════════════════════════════════════════════

function SubscriptionsTab() {
  const [params, setParams] = useState<TrendParams>({});
  const { data: summary, isLoading: loadingSummary } = useSubscriptionSummary(params);
  const { data: trend, isLoading: loadingTrend } = useSubscriptionTrend(params);
  const { data: distribution, isLoading: loadingDist } = useSubscriptionDistribution(params);

  const newSubsData: LineChartPoint[] = useMemo(() => {
    if (!trend?.data) return [];
    return trend.data.map((p: SubscriptionTrendPoint) => ({
      date: new Date(p.period),
      value: p.newSubscriptions,
      cumulative: p.netChange,
    }));
  }, [trend]);

  if (loadingSummary) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} showPeriod />

      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Active"
            value={formatNumber(summary.totalActive)}
            subLabel={`${summary.activePaid} paid, ${summary.activeTrial} trial`}
            icon={Users}
          />
          <MetricCard
            label="New (Period)"
            value={formatNumber(summary.newInPeriod)}
            trend={summary.newInPeriod > 0 ? 'up' : 'neutral'}
            icon={TrendingUp}
          />
          <MetricCard
            label="Cancelled (Period)"
            value={formatNumber(summary.cancelledInPeriod)}
            trend={summary.cancelledInPeriod > 0 ? 'down' : 'neutral'}
            icon={TrendingDown}
          />
          <MetricCard
            label="Churn Rate"
            value={formatPercent(summary.churnRate)}
            subLabel={`Net growth: ${summary.netGrowth >= 0 ? '+' : ''}${summary.netGrowth}`}
            icon={Percent}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Subscription Trend</CardTitle>
            <CardDescription>New subscriptions over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTrend ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : newSubsData.length > 0 ? (
              <LineChart data={newSubsData} width={550} height={300} showCumulative />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No trend data</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {loadingDist ? (
            <AdminCardSkeleton />
          ) : distribution ? (
            <>
              <DistributionList
                items={distribution.byPlan}
                total={distribution.byPlan.reduce((sum, i) => sum + i.count, 0)}
                label="By Plan"
              />
              <DistributionList
                items={distribution.byStatus}
                total={distribution.byStatus.reduce((sum, i) => sum + i.count, 0)}
                label="By Status"
              />
              <DistributionList
                items={distribution.byBillingPeriod}
                total={distribution.byBillingPeriod.reduce((sum, i) => sum + i.count, 0)}
                label="By Billing Period"
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Trials Tab
// ═══════════════════════════════════════════════════════════

function TrialsTab() {
  const [params, setParams] = useState<DateRangeParams>({});
  const { data: summary, isLoading } = useTrialSummary(params);

  if (isLoading) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} />

      {summary && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Trials"
              value={formatNumber(summary.totalTrials)}
              subLabel={`${summary.activeTrials} active now`}
              icon={CalendarDays}
            />
            <MetricCard
              label="Conversion Rate"
              value={formatPercent(summary.conversionRate)}
              trend={summary.conversionRate > 0.3 ? 'up' : 'down'}
              icon={TrendingUp}
            />
            <MetricCard
              label="Converted"
              value={formatNumber(summary.convertedTrials)}
              icon={Users}
            />
            <MetricCard
              label="Avg Duration"
              value={`${summary.avgTrialDurationDays.toFixed(1)} days`}
              icon={CalendarDays}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Trial Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2 text-center">
                  <p className="text-3xl font-bold">{summary.totalTrials}</p>
                  <p className="text-xs text-muted-foreground">Started</p>
                </div>
                <div className="space-y-2 text-center">
                  <p className="text-3xl font-bold text-green-600">{summary.convertedTrials}</p>
                  <p className="text-xs text-muted-foreground">Converted</p>
                </div>
                <div className="space-y-2 text-center">
                  <p className="text-3xl font-bold text-amber-600">{summary.expiredTrials}</p>
                  <p className="text-xs text-muted-foreground">Expired</p>
                </div>
                <div className="space-y-2 text-center">
                  <p className="text-3xl font-bold text-red-600">{summary.cancelledTrials}</p>
                  <p className="text-xs text-muted-foreground">Cancelled</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Conversion</span>
                  <Progress
                    value={summary.conversionRate * 100}
                    className="h-3 flex-1"
                  />
                  <span className="font-medium">{formatPercent(summary.conversionRate)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Payments Tab
// ═══════════════════════════════════════════════════════════

function PaymentsTab() {
  const [params, setParams] = useState<TrendParams>({});
  const { data: summary, isLoading: loadingSummary } = usePaymentSummary(params);
  const { data: trend, isLoading: loadingTrend } = usePaymentTrend(params);

  const successChartData: LineChartPoint[] = useMemo(() => {
    if (!trend?.data) return [];
    return trend.data.map((p: PaymentTrendPoint) => ({
      date: new Date(p.period),
      value: p.succeededCount,
      cumulative: p.succeededAmountPesos,
    }));
  }, [trend]);

  if (loadingSummary) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} showPeriod />

      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Revenue"
            value={formatPesos(summary.totalAmountPesos)}
            icon={DollarSign}
          />
          <MetricCard
            label="Success Rate"
            value={formatPercent(summary.successRate)}
            trend={summary.successRate > 0.95 ? 'up' : 'down'}
            icon={Percent}
          />
          <MetricCard
            label="Avg Transaction"
            value={formatPesos(summary.avgTransactionPesos)}
            icon={CreditCard}
          />
          <MetricCard
            label="Succeeded"
            value={formatNumber(summary.totalSucceeded)}
            subLabel={`Failed: ${summary.totalFailed} | Pending: ${summary.totalPending} | Refunded: ${summary.totalRefunded}`}
            icon={ArrowUpDown}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Payment Trend</CardTitle>
          <CardDescription>Succeeded payments over time</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTrend ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : successChartData.length > 0 ? (
            <LineChart data={successChartData} width={700} height={300} showCumulative />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No payment data</p>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Payment Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{formatNumber(summary.totalSucceeded)}</p>
                <p className="text-xs text-muted-foreground">Succeeded</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{formatNumber(summary.totalFailed)}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-amber-600">{formatNumber(summary.totalPending)}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{formatNumber(summary.totalRefunded)}</p>
                <p className="text-xs text-muted-foreground">Refunded</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Discounts Tab
// ═══════════════════════════════════════════════════════════

function DiscountsTab() {
  const [params, setParams] = useState<TopItemsParams>({});
  const { data: summary, isLoading: loadingSummary } = useDiscountSummary(params);
  const { data: topCoupons, isLoading: loadingCoupons } = useTopCoupons({ ...params, limit: 10 });
  const { data: topPromos, isLoading: loadingPromos } = useTopPromotions({ ...params, limit: 10 });

  if (loadingSummary) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} />

      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Discounts"
            value={formatPesos(summary.totalDiscountPesos)}
            icon={TicketIcon}
          />
          <MetricCard
            label="Coupon Discounts"
            value={formatPesos(summary.couponDiscountPesos)}
            subLabel={`${summary.totalCouponRedemptions} redemptions`}
            icon={TicketIcon}
          />
          <MetricCard
            label="Promotion Discounts"
            value={formatPesos(summary.promotionDiscountPesos)}
            subLabel={`${summary.totalPromotionRedemptions} redemptions`}
            icon={MegaphoneIcon}
          />
          <MetricCard
            label="Discount/Revenue"
            value={formatPercent(summary.discountToRevenueRatio)}
            trend={summary.discountToRevenueRatio < 0.1 ? 'up' : 'down'}
            icon={Percent}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Coupons</CardTitle>
            <CardDescription>By redemption count</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCoupons ? (
              <div className="h-40 animate-pulse rounded bg-muted" />
            ) : topCoupons && topCoupons.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Redeemed</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCoupons.map((c: TopCouponItem) => (
                    <TableRow key={c.couponId}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {c.code}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell className="text-right">{c.redemptionCount}</TableCell>
                      <TableCell className="text-right">{formatPesos(c.totalDiscountPesos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No coupon data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Promotions</CardTitle>
            <CardDescription>By discount amount</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingPromos ? (
              <div className="h-40 animate-pulse rounded bg-muted" />
            ) : topPromos && topPromos.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead className="text-right">Redeemed</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topPromos.map((p: TopPromotionItem) => (
                    <TableRow key={p.promotionId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {p.slug}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{p.redemptionCount}</TableCell>
                      <TableCell className="text-right">{formatPesos(p.totalDiscountPesos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No promotion data</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Customers Tab
// ═══════════════════════════════════════════════════════════

function CustomersTab() {
  const [params, setParams] = useState<DateRangeParams>({});
  const { data: summary, isLoading } = useCustomerSummary(params);

  if (isLoading) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateFilters params={params} onChange={setParams} />

      {summary && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Organizations"
              value={formatNumber(summary.totalOrganizations)}
              icon={Users}
            />
            <MetricCard
              label="New Signups"
              value={formatNumber(summary.newSignupsInPeriod)}
              trend={summary.newSignupsInPeriod > 0 ? 'up' : 'neutral'}
              icon={TrendingUp}
            />
            <MetricCard
              label="Seat Utilization"
              value={formatPercent(summary.seatUtilization)}
              subLabel={`${summary.usedSeats} / ${summary.totalSeats} seats`}
              icon={Users}
            />
            <MetricCard
              label="Seats Available"
              value={formatNumber(summary.totalSeats - summary.usedSeats)}
              icon={Users}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <DistributionList
              items={summary.byType}
              total={summary.totalOrganizations}
              label="Organizations by Type"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Seat Utilization</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="w-24 text-sm text-muted-foreground">Used</span>
                    <Progress
                      value={summary.seatUtilization * 100}
                      className="h-4 flex-1"
                    />
                    <span className="w-20 text-right text-sm font-medium">
                      {formatPercent(summary.seatUtilization)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{formatNumber(summary.usedSeats)}</p>
                      <p className="text-xs text-muted-foreground">Used Seats</p>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{formatNumber(summary.totalSeats)}</p>
                      <p className="text-xs text-muted-foreground">Total Seats</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════

export default function ReportingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reporting & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Business metrics, revenue analytics, and subscription health
        </p>
      </div>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="revenue" className="text-xs">
            <DollarSign className="mr-1 size-3.5" />
            Revenue
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="text-xs">
            <Users className="mr-1 size-3.5" />
            Subscriptions
          </TabsTrigger>
          <TabsTrigger value="trials" className="text-xs">
            <CalendarDays className="mr-1 size-3.5" />
            Trials
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs">
            <CreditCard className="mr-1 size-3.5" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="discounts" className="text-xs">
            <TicketIcon className="mr-1 size-3.5" />
            Discounts
          </TabsTrigger>
          <TabsTrigger value="customers" className="text-xs">
            <BarChart3 className="mr-1 size-3.5" />
            Customers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <RevenueTab />
        </TabsContent>
        <TabsContent value="subscriptions">
          <SubscriptionsTab />
        </TabsContent>
        <TabsContent value="trials">
          <TrialsTab />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountsTab />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
