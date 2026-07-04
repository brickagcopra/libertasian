'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, CheckIcon, LoaderIcon, TagIcon, TicketIcon, XIcon } from 'lucide-react';

import { useSubscription, meetsMinimumTier } from '@/features/billing/hooks/use-subscription';
import {
  useCreateCheckout,
  useCheckoutPreview,
  useValidateCoupon,
  useEligiblePromotions,
  useCancelSubscription,
  usePaymentMethods,
  useSetDefaultPaymentMethod,
  useDeletePaymentMethod,
  useInvoices,
} from '@/features/billing/hooks/use-billing';
import { usePlanInfoList } from '@/features/billing/hooks/use-plans';
import {
  PLAN_LABELS,
  TIER_ORDER,
  formatPHP,
  subscriptionHasAccess,
  subscriptionIsPastDue,
  type PlanInfo,
  type PaymentMethodDetail,
  type InvoiceDetail,
  type CouponValidationResult,
  type PromotionEligibilityResult,
  type CheckoutPreviewData,
} from '@/features/billing/types';
import { DunningBanner } from '@/features/billing/components/dunning-banner';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="link" asChild className="px-0 text-muted-foreground">
          <Link href="/settings">
            <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
            Settings
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Billing</h1>
      </div>

      <CurrentPlanSection />
      <PaymentMethodsSection />
      <InvoicesSection />
    </div>
  );
}

// ---- Current Plan ----

function CurrentPlanSection() {
  const { data: subscription, isLoading } = useSubscription();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  // Deep-link support: /settings/billing?plan=<code> (e.g. from the pricing
  // page CTAs) auto-opens the Choose-a-Plan dialog with that plan preselected.
  // Read from window to avoid Next's useSearchParams Suspense requirement —
  // mirrors the coupon pre-fill pattern in PlanSelectorContent.
  const [initialPlanCode, setInitialPlanCode] = useState<string | null>(null);
  const planParamProcessed = useRef(false);
  useEffect(() => {
    if (planParamProcessed.current) return;
    planParamProcessed.current = true;
    const plan = new URLSearchParams(window.location.search).get('plan');
    if (plan) {
      setInitialPlanCode(plan);
      setShowUpgrade(true);
    }
  }, []);

  if (isLoading) return <BillingSkeleton />;

  const status = subscription?.status;
  const planCode = subscription?.planCode ?? 'free';
  const planName = PLAN_LABELS[planCode] ?? 'Free';
  const isActive = status === 'active';
  const isPastDue = subscriptionIsPastDue(status);
  const hasAccess = subscriptionHasAccess(status);
  const cancelPending = subscription?.cancelAtPeriodEnd ?? false;
  const periodEnd = subscription?.currentPeriodEnd ?? null;
  const periodEndLabel = periodEnd ? formatLongDate(periodEnd) : null;

  return (
    <div className="space-y-4">
      {/* Dunning banner — failed cycle, Xendit auto-retrying (past_due / grace_period) */}
      {isPastDue && <DunningBanner periodEnd={periodEnd} />}

      <h2 className="text-lg font-semibold">Current Plan</h2>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{planName}</span>
                {isActive && !cancelPending && (
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
                )}
                {cancelPending && (
                  <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Cancels at period end</Badge>
                )}
                {isPastDue && !cancelPending && (
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                    {status === 'grace_period' ? 'Grace period' : 'Past due'}
                  </Badge>
                )}
                {status && !isActive && !isPastDue && !cancelPending && (
                  <Badge variant="secondary">{status}</Badge>
                )}
              </div>

              {subscription?.billingPeriod && planCode !== 'free' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Billed {subscription.billingPeriod} &middot; {subscription.seats} seat{subscription.seats > 1 ? 's' : ''}
                </p>
              )}

              {periodEndLabel && (
                cancelPending ? (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Your plan won&apos;t renew. Access ends on {periodEndLabel}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      To continue after {periodEndLabel}, subscribe again.
                    </p>
                  </>
                ) : isActive ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Renews automatically on {periodEndLabel}
                  </p>
                ) : isPastDue ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Access continues until {periodEndLabel} while we retry your payment.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Renews {periodEndLabel}
                  </p>
                )
              )}
            </div>

            <div className="flex gap-2">
              {planCode !== 'enterprise' && (
                <Button onClick={() => setShowUpgrade(true)}>
                  {planCode === 'free' ? 'Upgrade' : 'Change Plan'}
                </Button>
              )}
              {planCode !== 'free' && hasAccess && !cancelPending && (
                <Button variant="outline" onClick={() => setShowCancel(true)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan Selector Dialog */}
      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent className="sm:max-w-[min(64rem,calc(100%-2rem))] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a Plan</DialogTitle>
            <DialogDescription>
              Select a plan and billing period, then proceed to payment.
            </DialogDescription>
          </DialogHeader>
          <PlanSelectorContent
            currentPlan={planCode}
            initialPlanCode={initialPlanCode}
            onClose={() => setShowUpgrade(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <AlertDialog open={showCancel} onOpenChange={setShowCancel}>
        <AlertDialogContent>
          <CancelDialogContent
            periodEnd={subscription?.currentPeriodEnd ?? null}
            onClose={() => setShowCancel(false)}
          />
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Plan Selector ----

function PlanSelectorContent({
  currentPlan,
  initialPlanCode = null,
  onClose,
}: {
  currentPlan: string;
  /** Plan code from the URL to preselect (unknown codes leave the dialog unselected). */
  initialPlanCode?: string | null;
  onClose: () => void;
}) {
  const searchParams = useSearchParams();
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResult | null>(null);
  const [couponError, setCouponError] = useState('');

  // Promotion state
  const [eligiblePromos, setEligiblePromos] = useState<PromotionEligibilityResult[]>([]);
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null);

  // Preview state
  const [previewData, setPreviewData] = useState<CheckoutPreviewData | null>(null);

  // URL coupon pre-fill flag
  const urlCouponApplied = useRef(false);

  // Hooks
  const createCheckout = useCreateCheckout();
  const checkoutPreview = useCheckoutPreview();
  const validateCoupon = useValidateCoupon();
  const eligiblePromotions = useEligiblePromotions();
  const { plans: allPlans, isLoading: plansLoading } = usePlanInfoList();

  const upgradePlans = allPlans.filter(
    (p) => p.code !== 'free' && TIER_ORDER.indexOf(p.code) > TIER_ORDER.indexOf(currentPlan),
  );

  const selectedPlanInfo = upgradePlans.find((p) => p.code === selectedPlanCode) ?? null;

  // Pre-fill coupon from URL on mount
  useEffect(() => {
    const urlCoupon = searchParams?.get('coupon') ?? null;
    if (urlCoupon && !urlCouponApplied.current) {
      setCouponInput(urlCoupon.toUpperCase());
      urlCouponApplied.current = true;
    }
  }, [searchParams]);

  // Preselect the URL-supplied plan once plans have loaded. Defensive:
  // unknown/ineligible plan codes are ignored and the dialog opens unselected.
  const initialPlanApplied = useRef(false);
  useEffect(() => {
    if (initialPlanApplied.current || !initialPlanCode || plansLoading) return;
    initialPlanApplied.current = true;
    if (upgradePlans.some((p) => p.code === initialPlanCode)) {
      setSelectedPlanCode(initialPlanCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlanCode, plansLoading, upgradePlans]);

  // Fetch eligible promotions when plan or billing period changes
  useEffect(() => {
    if (!selectedPlanCode) {
      setEligiblePromos([]);
      setSelectedPromoId(null);
      return;
    }

    eligiblePromotions.mutate(
      { planCode: selectedPlanCode, billingPeriod },
      {
        onSuccess: (data) => {
          const eligible = data.filter((p) => p.eligible);
          setEligiblePromos(eligible);
          // Auto-select first eligible promotion
          const firstEligible = eligible[0];
          setSelectedPromoId(firstEligible ? firstEligible.promotionId : null);
        },
        onError: () => {
          setEligiblePromos([]);
          setSelectedPromoId(null);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanCode, billingPeriod]);

  // Auto-validate URL coupon after plan is selected
  useEffect(() => {
    if (selectedPlanCode && couponInput && !appliedCoupon && urlCouponApplied.current) {
      handleApplyCoupon();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanCode]);

  // Fetch checkout preview when relevant inputs change
  useEffect(() => {
    if (!selectedPlanCode) {
      setPreviewData(null);
      return;
    }

    checkoutPreview.mutate(
      {
        planCode: selectedPlanCode as 'edu' | 'pro' | 'team' | 'enterprise',
        billingPeriod,
        couponCode: appliedCoupon?.valid ? appliedCoupon.coupon?.code : undefined,
        promotionId: selectedPromoId ?? undefined,
      },
      {
        onSuccess: (data) => setPreviewData(data),
        onError: () => setPreviewData(null),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanCode, billingPeriod, appliedCoupon, selectedPromoId]);

  const handleApplyCoupon = useCallback(() => {
    const code = couponInput.trim().toUpperCase();
    if (!code || !selectedPlanCode) return;

    setCouponError('');
    validateCoupon.mutate(
      { code, planCode: selectedPlanCode, billingPeriod },
      {
        onSuccess: (result) => {
          if (result.valid) {
            setAppliedCoupon(result);
            setCouponError('');
          } else {
            setAppliedCoupon(null);
            setCouponError(result.errors[0] ?? 'Invalid coupon code');
          }
        },
        onError: (error) => {
          setAppliedCoupon(null);
          setCouponError(
            error instanceof ApiClientError ? error.message : 'Failed to validate coupon',
          );
        },
      },
    );
  }, [couponInput, selectedPlanCode, billingPeriod, validateCoupon]);

  const handleRemoveCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponError('');
    setCouponInput('');
  }, []);

  const handleSelectPlan = useCallback((planCode: string) => {
    setSelectedPlanCode((prev) => (prev === planCode ? null : planCode));
    setErrorMsg('');
  }, []);

  const handleBillingPeriodChange = useCallback(
    (period: 'monthly' | 'annual') => {
      setBillingPeriod(period);
      // Clear coupon on period change since it may not apply
      if (appliedCoupon) {
        setAppliedCoupon(null);
        setCouponError('');
      }
    },
    [appliedCoupon],
  );

  const handleProceedToPayment = async () => {
    if (!selectedPlanCode) return;
    try {
      setErrorMsg('');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const result = await createCheckout.mutateAsync({
        planCode: selectedPlanCode as 'edu' | 'pro' | 'team' | 'enterprise',
        billingPeriod,
        successUrl: `${origin}/settings/billing/success`,
        cancelUrl: `${origin}/settings/billing/cancel`,
        couponCode: appliedCoupon?.valid ? appliedCoupon.coupon?.code : undefined,
        promotionId: selectedPromoId ?? undefined,
      });
      window.location.href = result.checkoutUrl;
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Failed to create checkout session');
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Billing period toggle */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleBillingPeriodChange('monthly')}
        >
          Monthly
        </Button>
        <Button
          variant={billingPeriod === 'annual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleBillingPeriodChange('annual')}
        >
          Annual <span className="ml-1 text-xs text-green-600">(Save ~17%)</span>
        </Button>
      </div>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {/* Phase 1: Plan cards */}
      {plansLoading && (
        <div className="flex items-center justify-center py-8">
          <LoaderIcon className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading plans...</span>
        </div>
      )}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
        {upgradePlans.map((plan) => {
          const price = billingPeriod === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
          const isCurrentPlan = plan.code === currentPlan;
          const isSelected = selectedPlanCode === plan.code;

          return (
            <Card
              key={plan.code}
              className={cn(
                'cursor-pointer transition-all',
                isSelected
                  ? 'border-primary ring-2 ring-primary'
                  : plan.highlight
                    ? 'border-primary/50 ring-1 ring-primary/50'
                    : 'hover:border-primary/30',
                isCurrentPlan && 'cursor-not-allowed opacity-60',
              )}
              onClick={() => !isCurrentPlan && handleSelectPlan(plan.code)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-1.5">
                  <h4 className="min-w-0 truncate font-semibold">{plan.name}</h4>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {plan.highlight && <Badge>Popular</Badge>}
                    {isSelected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <CheckIcon className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2">
                  <span className="text-2xl font-bold">
                    {price === 0 ? 'Free' : `\u20B1${price.toLocaleString()}`}
                  </span>
                  {price > 0 && (
                    <span className="text-sm text-muted-foreground">
                      /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
                    </span>
                  )}
                  {plan.code === 'team' && (
                    <span className="block text-xs text-muted-foreground">per seat, min 3</span>
                  )}
                </div>

                <ul className="mt-3 space-y-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-500" />
                      <span className="min-w-0 break-words">{feature}</span>
                    </li>
                  ))}
                </ul>

                {isCurrentPlan && (
                  <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
                    Current plan
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {upgradePlans.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          You are on the highest available plan.
        </p>
      )}

      {/* Phase 2: Coupon, promotions, preview — shown when a plan is selected */}
      {selectedPlanCode && selectedPlanInfo && (
        <div className="space-y-4 pt-2">
          <Separator />

          {/* Coupon input */}
          <CouponInputSection
            couponInput={couponInput}
            setCouponInput={setCouponInput}
            appliedCoupon={appliedCoupon}
            couponError={couponError}
            isValidating={validateCoupon.isPending}
            onApply={handleApplyCoupon}
            onRemove={handleRemoveCoupon}
          />

          {/* Eligible promotions */}
          {eligiblePromos.length > 0 && (
            <EligiblePromotionBadges
              promotions={eligiblePromos}
              selectedPromoId={selectedPromoId}
              onToggle={(promoId) =>
                setSelectedPromoId((prev) => (prev === promoId ? null : promoId))
              }
            />
          )}

          {/* Price breakdown */}
          {checkoutPreview.isPending && (
            <div className="flex items-center justify-center py-4">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Calculating price...</span>
            </div>
          )}

          {previewData && !checkoutPreview.isPending && (
            <PriceBreakdownCard preview={previewData} />
          )}

          {/* Proceed to payment */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleProceedToPayment}
            disabled={createCheckout.isPending || checkoutPreview.isPending}
          >
            {createCheckout.isPending ? (
              <>
                <LoaderIcon className="mr-1.5 h-4 w-4 animate-spin" />
                Redirecting to payment...
              </>
            ) : (
              <>
                Proceed to Payment
                {previewData ? ` \u2014 ${formatPHP(previewData.finalAmount)}` : ''}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Coupon Input ----

function CouponInputSection({
  couponInput,
  setCouponInput,
  appliedCoupon,
  couponError,
  isValidating,
  onApply,
  onRemove,
}: {
  couponInput: string;
  setCouponInput: (value: string) => void;
  appliedCoupon: CouponValidationResult | null;
  couponError: string;
  isValidating: boolean;
  onApply: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor="coupon-code" className="flex items-center gap-1.5 text-sm font-medium">
        <TicketIcon className="h-4 w-4" />
        Coupon Code
      </label>

      {appliedCoupon?.valid ? (
        <div className="flex items-center gap-2">
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1.5 py-1 px-3">
            <CheckIcon className="h-3 w-3" />
            {appliedCoupon.coupon?.code}
            {appliedCoupon.coupon?.discountType === 'percentage'
              ? ` \u2014 ${appliedCoupon.coupon.discountValue}% off`
              : appliedCoupon.coupon
                ? ` \u2014 ${formatPHP(appliedCoupon.coupon.discountValue)} off`
                : ''}
          </Badge>
          <button
            onClick={onRemove}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Remove coupon"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            id="coupon-code"
            name="couponCode"
            placeholder="Enter coupon code"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onApply();
              }
            }}
            className="max-w-xs"
            disabled={isValidating}
          />
          <Button
            variant="outline"
            onClick={onApply}
            disabled={isValidating || !couponInput.trim()}
          >
            {isValidating ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              'Apply'
            )}
          </Button>
        </div>
      )}

      {couponError && (
        <p className="text-sm text-destructive">{couponError}</p>
      )}
    </div>
  );
}

// ---- Eligible Promotion Badges ----

function EligiblePromotionBadges({
  promotions,
  selectedPromoId,
  onToggle,
}: {
  promotions: PromotionEligibilityResult[];
  selectedPromoId: string | null;
  onToggle: (promoId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <TagIcon className="h-4 w-4" />
        Available Promotions
      </label>
      <div className="flex flex-wrap gap-2">
        {promotions.map((promo) => {
          const isSelected = promo.promotionId === selectedPromoId;
          const discountLabel = promo.discountPreview
            ? promo.discountPreview.discountType === 'percentage'
              ? `${promo.discountPreview.discountValue}% off`
              : `${formatPHP(promo.discountPreview.discountAmount)} off`
            : '';

          return (
            <Badge
              key={promo.promotionId}
              className={cn(
                'cursor-pointer select-none px-3 py-1 transition-colors',
                isSelected
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
              onClick={() => onToggle(promo.promotionId)}
            >
              {promo.promotionName}
              {discountLabel && ` (${discountLabel})`}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// ---- Price Breakdown ----

function PriceBreakdownCard({ preview }: { preview: CheckoutPreviewData }) {
  const totalSavings = preview.totalDiscountAmount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Price Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {preview.lineItems.map((item, idx) => {
          const isDiscount = item.type !== 'base_price';
          return (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className={cn(isDiscount && 'text-green-600')}>
                {item.label}
              </span>
              <span className={cn('font-medium', isDiscount && 'text-green-600')}>
                {isDiscount ? `\u2212${formatPHP(Math.abs(item.amount))}` : formatPHP(item.amount)}
              </span>
            </div>
          );
        })}

        <Separator className="my-2" />

        <div className="flex items-center justify-between text-sm font-bold">
          <span>Total</span>
          <span>{formatPHP(preview.finalAmount)}</span>
        </div>

        {totalSavings > 0 && (
          <p className="text-sm font-medium text-green-600">
            You save {formatPHP(totalSavings)}!
          </p>
        )}

        {!preview.discountsStacked && preview.couponDiscountAmount > 0 && preview.promotionDiscountAmount > 0 && (
          <p className="text-xs text-muted-foreground">
            Discounts cannot be stacked. The better discount has been applied.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {preview.isNewSubscription
            ? 'New subscription'
            : preview.isUpgrade
              ? 'Upgrade from current plan'
              : 'Plan change'}{' '}
          &middot; {preview.planName} &middot;{' '}
          {preview.billingPeriod === 'monthly' ? 'Monthly' : 'Annual'} billing
        </p>
      </CardContent>
    </Card>
  );
}

// ---- Cancel Dialog ----

function CancelDialogContent({
  periodEnd,
  onClose,
}: {
  periodEnd: string | null;
  onClose: () => void;
}) {
  const cancelSubscription = useCancelSubscription();
  const [errorMsg, setErrorMsg] = useState('');
  const [cancelType, setCancelType] = useState<'end_of_period' | 'immediately'>('end_of_period');

  const handleCancel = async () => {
    try {
      setErrorMsg('');
      await cancelSubscription.mutateAsync({
        cancelAtPeriodEnd: cancelType === 'end_of_period',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Failed to cancel subscription');
      }
    }
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to cancel? You will lose access to premium features.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <RadioGroup
        value={cancelType}
        onValueChange={(v) => setCancelType(v as 'end_of_period' | 'immediately')}
        className="space-y-3"
      >
        <div className="flex items-start gap-3">
          <RadioGroupItem value="end_of_period" id="cancel-end" className="mt-1" />
          <div>
            <Label htmlFor="cancel-end" className="font-medium">Cancel at end of billing period</Label>
            <p className="text-xs text-muted-foreground">
              Stops auto-renewal.{' '}
              {periodEnd ? `You keep access until ${formatLongDate(periodEnd)}, ` : 'You keep access until the period ends, '}
              then your plan ends. This can&apos;t be undone — you&apos;d re-subscribe to return.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <RadioGroupItem value="immediately" id="cancel-now" className="mt-1" />
          <div>
            <Label htmlFor="cancel-now" className="font-medium">Cancel immediately</Label>
            <p className="text-xs text-muted-foreground">
              Downgrade to Free plan right away. No refund for remaining period.
            </p>
          </div>
        </div>
      </RadioGroup>

      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose}>Keep Plan</AlertDialogCancel>
        <AlertDialogAction
          onClick={handleCancel}
          disabled={cancelSubscription.isPending}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {cancelSubscription.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

// ---- Payment Methods ----

function PaymentMethodsSection() {
  const { data: methods, isLoading, error } = usePaymentMethods();
  const { data: subscription } = useSubscription();
  const setDefault = useSetDefaultPaymentMethod();
  const deleteMethod = useDeletePaymentMethod();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // With auto-renew recurring billing, the default method backs the live
  // subscription — removing it would break the next Xendit charge, so guard it.
  const backsAutoRenew = subscriptionHasAccess(subscription?.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payment Methods</h2>
        {/* Replacing a saved method requires a Xendit re-link flow that doesn't
            exist yet — offer a disabled affordance, not a fake flow. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" size="sm" disabled>
                Update payment method
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming soon</TooltipContent>
        </Tooltip>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiClientError ? error.message : 'Failed to load payment methods'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <BillingSkeleton />}

      {!isLoading && methods && methods.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No payment method on file. One is saved automatically when you subscribe,
            and is used to auto-renew your plan.
          </CardContent>
        </Card>
      )}

      {!isLoading && methods && methods.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {methods.map((method) => {
                const isBackingMethod = method.isDefault && backsAutoRenew;

                return (
                  <div key={method.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <PaymentMethodIcon type={method.type} brand={method.brand} />
                      <div>
                        <p className="text-sm font-medium">
                          {formatPaymentMethod(method)}
                        </p>
                        {method.expiryMonth && method.expiryYear && (
                          <p className="text-xs text-muted-foreground">
                            Expires {String(method.expiryMonth).padStart(2, '0')}/{method.expiryYear}
                          </p>
                        )}
                        {method.billingEmail && (
                          <p className="text-xs text-muted-foreground">{method.billingEmail}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {method.isDefault ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Default</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefault.mutate(method.id)}
                          disabled={setDefault.isPending}
                        >
                          Set default
                        </Button>
                      )}

                      {isBackingMethod ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled
                              >
                                Remove
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            This method auto-renews your subscription. Cancel your plan
                            before removing it.
                          </TooltipContent>
                        </Tooltip>
                      ) : confirmDeleteId === method.id ? (
                        <span className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive font-semibold hover:text-destructive"
                            onClick={() => {
                              deleteMethod.mutate(method.id);
                              setConfirmDeleteId(null);
                            }}
                            disabled={deleteMethod.isPending}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteId(method.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentMethodIcon({ type, brand }: { type: string; brand: string | null }) {
  const label = type === 'card' ? (brand ?? 'Card') : type === 'gcash' ? 'GCash' : type === 'maya' ? 'Maya' : type;
  return (
    <div className="flex h-8 w-12 items-center justify-center rounded border bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
      {label.substring(0, 4)}
    </div>
  );
}

function formatPaymentMethod(method: PaymentMethodDetail): string {
  if (method.type === 'card') {
    const brand = method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'Card';
    return method.last4 ? `${brand} ending in ${method.last4}` : brand;
  }
  if (method.type === 'gcash') return 'GCash';
  if (method.type === 'maya') return 'Maya';
  // Generic e-wallet fallback — capitalize the wallet type for a clean label.
  return method.type.charAt(0).toUpperCase() + method.type.slice(1);
}

// ---- Invoices ----

const invoiceStatusVariant: Record<string, string> = {
  paid: 'bg-green-100 text-green-700 hover:bg-green-100',
  open: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
  draft: 'bg-muted text-muted-foreground hover:bg-muted',
  void: 'bg-red-100 text-red-700 hover:bg-red-100',
};

function InvoicesSection() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, isLoading, error } = useInvoices(cursor);

  const invoices = data?.data ?? [];
  const hasNext = data?.meta?.hasNext ?? false;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Invoices</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiClientError ? error.message : 'Failed to load invoices'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <BillingSkeleton />}

      {!isLoading && invoices.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No invoices yet.
          </CardContent>
        </Card>
      )}

      {!isLoading && invoices.length > 0 && (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <InvoiceRow key={invoice.id} invoice={invoice} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {hasNext && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  const lastInvoice = invoices[invoices.length - 1];
                  if (lastInvoice) setCursor(lastInvoice.id);
                }}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceDetail }) {
  const statusClass = invoiceStatusVariant[invoice.status] ?? invoiceStatusVariant.draft;

  return (
    <TableRow>
      <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
      <TableCell>
        {new Date(invoice.createdAt).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </TableCell>
      <TableCell>
        {invoice.currency === 'PHP' ? '\u20B1' : invoice.currency}{' '}
        {(invoice.amount / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
      </TableCell>
      <TableCell>
        <Badge className={`capitalize ${statusClass}`}>
          {invoice.status}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {invoice.billingPeriodStart && invoice.billingPeriodEnd
          ? `${new Date(invoice.billingPeriodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} \u2014 ${new Date(invoice.billingPeriodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : '\u2014'}
      </TableCell>
    </TableRow>
  );
}

// ---- Helpers ----

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ---- Skeleton ----

function BillingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
