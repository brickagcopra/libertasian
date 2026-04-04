'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';

import {
  useAdminSubscription,
  useSubscriptionHistory,
  useSubscriptionMigrations,
  useEntitlementOverrides,
  useForceCancelSubscription,
  useExtendTrial,
  useChangeBillingPeriod,
  useExpireTrial,
  useRevokeComplimentary,
  useGrantEntitlementOverride,
  useRevokeEntitlementOverride,
} from '@/features/billing/hooks/use-admin-subscriptions';
import { formatPHP } from '@/features/billing/types';
import type {
  ListSubscriptionHistoryQuery,
  ListSubscriptionMigrationsQuery,
  ListEntitlementOverridesQuery,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

// ─── Status Colors ──────────────────────────────────────

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  complimentary: 'bg-purple-100 text-purple-700',
  past_due: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700',
  terminated: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-700',
  trial_expired: 'bg-amber-100 text-amber-700',
  cancelling: 'bg-amber-100 text-amber-700',
  grace_period: 'bg-amber-100 text-amber-700',
  provisioning: 'bg-sky-100 text-sky-700',
  migrating: 'bg-sky-100 text-sky-700',
};

const statusLabels: Record<string, string> = {
  provisioning: 'Provisioning',
  trialing: 'Trialing',
  trial_expired: 'Trial Expired',
  active: 'Active',
  past_due: 'Past Due',
  grace_period: 'Grace Period',
  suspended: 'Suspended',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  expired: 'Expired',
  complimentary: 'Complimentary',
  migrating: 'Migrating',
  terminated: 'Terminated',
};

// ─── Zod Schemas ────────────────────────────────────────

const forceCancelSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
});

const extendTrialSchema = z.object({
  extensionDays: z.coerce.number().min(1, 'Min 1 day').max(90, 'Max 90 days'),
});

const changeBillingPeriodSchema = z.object({
  billingPeriod: z.enum(['monthly', 'annual']),
});

const revokeComplimentarySchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
});

const grantOverrideSchema = z.object({
  organizationId: z.string().uuid(),
  entitlementKey: z.string().min(1, 'Required').max(100),
  overrideType: z.enum(['bonus_credit', 'admin_override', 'promo']),
  numericValue: z.coerce.number().optional(),
  booleanValue: z.boolean().optional(),
  reason: z.string().min(1, 'Required').max(500),
  sourceType: z.enum(['admin', 'coupon', 'promotion', 'system']),
  sourceId: z.string().uuid().optional().or(z.literal('')),
  startsAt: z.string().min(1, 'Required'),
  expiresAt: z.string().optional(),
});

const revokeOverrideSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
});

type ForceCancelForm = z.infer<typeof forceCancelSchema>;
type ExtendTrialForm = z.infer<typeof extendTrialSchema>;
type ChangeBillingPeriodForm = z.infer<typeof changeBillingPeriodSchema>;
type RevokeComplimentaryForm = z.infer<typeof revokeComplimentarySchema>;
type GrantOverrideForm = z.infer<typeof grantOverrideSchema>;
type RevokeOverrideForm = z.infer<typeof revokeOverrideSchema>;

// ─── Helpers ────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function formatDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

// ─── Page ───────────────────────────────────────────────

export default function AdminSubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: subscription, isLoading, error } = useAdminSubscription(id);

  // Paginated sub-queries
  const [historyParams, setHistoryParams] = useState<ListSubscriptionHistoryQuery>({});
  const [migrationsParams, setMigrationsParams] = useState<ListSubscriptionMigrationsQuery>({});
  const [overridesParams, setOverridesParams] = useState<Omit<ListEntitlementOverridesQuery, 'organizationId'>>({});

  const { data: historyRes } = useSubscriptionHistory(id, historyParams);
  const { data: migrationsRes } = useSubscriptionMigrations(id, migrationsParams);
  const { data: overridesRes } = useEntitlementOverrides({
    organizationId: subscription?.organizationId ?? '',
    ...overridesParams,
  });

  // Mutations
  const forceCancelMutation = useForceCancelSubscription();
  const extendTrialMutation = useExtendTrial();
  const changeBillingPeriodMutation = useChangeBillingPeriod();
  const expireTrialMutation = useExpireTrial();
  const revokeComplimentaryMutation = useRevokeComplimentary();
  const grantOverrideMutation = useGrantEntitlementOverride();
  const revokeOverrideMutation = useRevokeEntitlementOverride();

  // Modal state
  const [showForceCancel, setShowForceCancel] = useState(false);
  const [showExtendTrial, setShowExtendTrial] = useState(false);
  const [showChangeBilling, setShowChangeBilling] = useState(false);
  const [showExpireTrial, setShowExpireTrial] = useState(false);
  const [showRevokeComp, setShowRevokeComp] = useState(false);
  const [showGrantOverride, setShowGrantOverride] = useState(false);
  const [revokeOverrideTarget, setRevokeOverrideTarget] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Forms
  const forceCancelForm = useForm<ForceCancelForm>({
    resolver: zodResolver(forceCancelSchema),
  });
  const extendTrialForm = useForm<ExtendTrialForm>({
    resolver: zodResolver(extendTrialSchema),
    defaultValues: { extensionDays: 7 },
  });
  const changeBillingForm = useForm<ChangeBillingPeriodForm>({
    resolver: zodResolver(changeBillingPeriodSchema),
    defaultValues: { billingPeriod: 'annual' },
  });
  const revokeCompForm = useForm<RevokeComplimentaryForm>({
    resolver: zodResolver(revokeComplimentarySchema),
  });
  const grantOverrideForm = useForm<GrantOverrideForm>({
    resolver: zodResolver(grantOverrideSchema),
    defaultValues: {
      overrideType: 'admin_override',
      sourceType: 'admin',
      startsAt: new Date().toISOString().slice(0, 16),
    },
  });
  const revokeOverrideForm = useForm<RevokeOverrideForm>({
    resolver: zodResolver(revokeOverrideSchema),
  });

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Action handlers
  const onForceCancel = async (data: ForceCancelForm) => {
    try {
      await forceCancelMutation.mutateAsync({ id, data });
      setShowForceCancel(false);
      forceCancelForm.reset();
      flash('Subscription force-cancelled.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        forceCancelForm.setError('root', { message: err.message });
      }
    }
  };

  const onExtendTrial = async (data: ExtendTrialForm) => {
    try {
      await extendTrialMutation.mutateAsync({ id, data });
      setShowExtendTrial(false);
      extendTrialForm.reset();
      flash(`Trial extended by ${data.extensionDays} days.`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        extendTrialForm.setError('root', { message: err.message });
      }
    }
  };

  const onChangeBilling = async (data: ChangeBillingPeriodForm) => {
    try {
      await changeBillingPeriodMutation.mutateAsync({ id, data });
      setShowChangeBilling(false);
      changeBillingForm.reset();
      flash(`Billing period changed to ${data.billingPeriod}.`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        changeBillingForm.setError('root', { message: err.message });
      }
    }
  };

  const onExpireTrial = async () => {
    try {
      await expireTrialMutation.mutateAsync(id);
      setShowExpireTrial(false);
      flash('Trial expired.');
    } catch {
      // mutation error displayed by caller
    }
  };

  const onRevokeComp = async (data: RevokeComplimentaryForm) => {
    try {
      await revokeComplimentaryMutation.mutateAsync({ id, data });
      setShowRevokeComp(false);
      revokeCompForm.reset();
      flash('Complimentary access revoked.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        revokeCompForm.setError('root', { message: err.message });
      }
    }
  };

  const onGrantOverride = async (data: GrantOverrideForm) => {
    try {
      await grantOverrideMutation.mutateAsync({
        ...data,
        sourceId: data.sourceId || undefined,
        expiresAt: data.expiresAt || undefined,
      });
      setShowGrantOverride(false);
      grantOverrideForm.reset();
      flash('Entitlement override granted.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        grantOverrideForm.setError('root', { message: err.message });
      }
    }
  };

  const onRevokeOverride = async (data: RevokeOverrideForm) => {
    if (!revokeOverrideTarget) return;
    try {
      await revokeOverrideMutation.mutateAsync({
        id: revokeOverrideTarget,
        data,
      });
      setRevokeOverrideTarget(null);
      revokeOverrideForm.reset();
      flash('Entitlement override revoked.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        revokeOverrideForm.setError('root', { message: err.message });
      }
    }
  };

  if (isLoading) return <AdminListSkeleton />;

  if (error || !subscription) {
    return (
      <div className="space-y-4 p-6">
        <Link
          href="/admin/subscriptions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Subscriptions
        </Link>
        <Alert variant="destructive">
          <AlertDescription>Failed to load subscription details.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const validActions = subscription.validActions ?? [];
  const showForceCancelBtn = validActions.includes('CANCEL_IMMEDIATELY');
  const showExtendTrialBtn = subscription.status === 'trialing';
  const showChangeBillingBtn = subscription.status === 'active';
  const showExpireTrialBtn = validActions.includes('EXPIRE_TRIAL');
  const showRevokeCompBtn = subscription.status === 'complimentary';

  return (
    <div className="space-y-6 p-6">
      {/* Back link */}
      <Link
        href="/admin/subscriptions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Subscriptions
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{subscription.organization.name}</h1>
            <Badge
              variant="secondary"
              className={statusColors[subscription.status] ?? ''}
            >
              {statusLabels[subscription.status] ?? subscription.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscription {subscription.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showForceCancelBtn && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowForceCancel(true)}
            >
              Force Cancel
            </Button>
          )}
          {showExtendTrialBtn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExtendTrial(true)}
            >
              Extend Trial
            </Button>
          )}
          {showChangeBillingBtn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowChangeBilling(true)}
            >
              Change Billing Period
            </Button>
          )}
          {showExpireTrialBtn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExpireTrial(true)}
            >
              Expire Trial
            </Button>
          )}
          {showRevokeCompBtn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRevokeComp(true)}
            >
              Revoke Complimentary
            </Button>
          )}
        </div>
      </div>

      {successMsg && (
        <Alert>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="migrations">Migrations</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab ───────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          {/* Subscription Details */}
          <Card>
            <CardHeader>
              <CardTitle>Subscription Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium">{subscription.plan?.name ?? subscription.planCode}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">{statusLabels[subscription.status] ?? subscription.status}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Billing Period</dt>
                  <dd className="font-medium capitalize">{subscription.billingPeriod}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="font-medium">{subscription.seats}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cancel at Period End</dt>
                  <dd className="font-medium">{subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Canceled At</dt>
                  <dd className="font-medium">{formatDate(subscription.canceledAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Period Start</dt>
                  <dd className="font-medium">{formatDate(subscription.currentPeriodStart)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Period End</dt>
                  <dd className="font-medium">{formatDate(subscription.currentPeriodEnd)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Trial Start</dt>
                  <dd className="font-medium">{formatDate(subscription.trialStart)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Trial End</dt>
                  <dd className="font-medium">{formatDate(subscription.trialEnd)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="font-medium">{formatDate(subscription.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Organization</dt>
                  <dd className="font-medium">{subscription.organization.name} ({subscription.organization.slug})</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Trial Records */}
          {subscription.trialRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Trial Records</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Ends</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Converted To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscription.trialRecords.map((tr) => (
                      <TableRow key={tr.id}>
                        <TableCell>{tr.planCode}</TableCell>
                        <TableCell>{tr.trialDurationDays} days</TableCell>
                        <TableCell>{formatDateShort(tr.trialStartedAt)}</TableCell>
                        <TableCell>{formatDateShort(tr.trialEndsAt)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{tr.status}</Badge>
                        </TableCell>
                        <TableCell>{tr.convertedToPlanCode ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Complimentary Access */}
          {subscription.complimentaryAccess.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Complimentary Access</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Starts</TableHead>
                      <TableHead>Ends</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscription.complimentaryAccess.map((ca) => (
                      <TableRow key={ca.id}>
                        <TableCell>{ca.planCode}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{ca.reason}</TableCell>
                        <TableCell>{formatDateShort(ca.startsAt)}</TableCell>
                        <TableCell>{formatDateShort(ca.endsAt)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ca.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Pending Lifecycle Events */}
          {subscription.lifecycleEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Pending Lifecycle Events</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Scheduled At</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscription.lifecycleEvents.map((ev) => (
                      <TableRow key={ev.id}>
                        <TableCell className="font-medium">{ev.eventType}</TableCell>
                        <TableCell>{formatDate(ev.scheduledAt)}</TableCell>
                        <TableCell>{ev.attempts} / {ev.maxAttempts}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ev.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── History Tab ────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>From State</TableHead>
                    <TableHead>To State</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!historyRes?.data || historyRes.data.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No history records.
                      </TableCell>
                    </TableRow>
                  ) : (
                    historyRes.data.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-mono text-xs font-medium">{h.action}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColors[h.fromState] ?? ''}>
                            {statusLabels[h.fromState] ?? h.fromState}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColors[h.toState] ?? ''}>
                            {statusLabels[h.toState] ?? h.toState}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{h.actorType}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">
                          {h.reason ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(h.createdAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {historyRes?.hasNext && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() =>
                  setHistoryParams((prev) => ({
                    ...prev,
                    cursor: historyRes.nextCursor ?? undefined,
                  }))
                }
              >
                Load More
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Migrations Tab ────────────────────────────── */}
        <TabsContent value="migrations" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>From Plan</TableHead>
                    <TableHead>To Plan</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Net Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!migrationsRes?.data || migrationsRes.data.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No migrations found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    migrationsRes.data.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              m.direction === 'upgrade'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }
                          >
                            {m.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{m.fromPlanCode}</TableCell>
                        <TableCell className="font-medium">{m.toPlanCode}</TableCell>
                        <TableCell className="text-sm">
                          {m.fromBillingPeriod ?? '—'} → {m.toBillingPeriod ?? '—'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatPHP(m.netAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{m.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDateShort(m.createdAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {migrationsRes?.hasNext && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() =>
                  setMigrationsParams((prev) => ({
                    ...prev,
                    cursor: migrationsRes.nextCursor ?? undefined,
                  }))
                }
              >
                Load More
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Entitlements Tab ───────────────────────────── */}
        <TabsContent value="entitlements" className="space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                grantOverrideForm.setValue('organizationId', subscription.organizationId);
                setShowGrantOverride(true);
              }}
            >
              Add Override
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!overridesRes?.data || overridesRes.data.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No entitlement overrides.
                      </TableCell>
                    </TableRow>
                  ) : (
                    overridesRes.data.map((ov) => (
                      <TableRow key={ov.id}>
                        <TableCell className="font-mono text-xs">{ov.entitlementKey}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ov.overrideType}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {ov.numericValue !== null
                            ? ov.numericValue
                            : ov.booleanValue !== null
                              ? String(ov.booleanValue)
                              : '—'}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate text-sm">
                          {ov.reason}
                        </TableCell>
                        <TableCell className="text-sm">{ov.sourceType}</TableCell>
                        <TableCell className="text-sm">{formatDateShort(ov.expiresAt)}</TableCell>
                        <TableCell>
                          {!ov.revokedAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setRevokeOverrideTarget(ov.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {overridesRes?.hasNext && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() =>
                  setOverridesParams((prev) => ({
                    ...prev,
                    cursor: overridesRes.nextCursor ?? undefined,
                  }))
                }
              >
                Load More
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── Action Modals ───────────────────────────────── */}

      {/* Force Cancel */}
      <Dialog open={showForceCancel} onOpenChange={setShowForceCancel}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Force Cancel Subscription</DialogTitle>
            <DialogDescription>
              This will immediately cancel the subscription. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={forceCancelForm.handleSubmit(onForceCancel)} className="space-y-4">
            {forceCancelForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{forceCancelForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="fc-reason">Reason *</Label>
              <Textarea
                id="fc-reason"
                rows={3}
                placeholder="Reason for force cancellation..."
                {...forceCancelForm.register('reason')}
              />
              {forceCancelForm.formState.errors.reason && (
                <p className="text-xs text-destructive">
                  {forceCancelForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForceCancel(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={forceCancelForm.formState.isSubmitting}>
                {forceCancelForm.formState.isSubmitting ? 'Cancelling...' : 'Force Cancel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Extend Trial */}
      <Dialog open={showExtendTrial} onOpenChange={setShowExtendTrial}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend Trial</DialogTitle>
            <DialogDescription>
              Extend the trial end date by a number of days (1-90).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={extendTrialForm.handleSubmit(onExtendTrial)} className="space-y-4">
            {extendTrialForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{extendTrialForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="et-days">Extension Days *</Label>
              <Input
                id="et-days"
                type="number"
                min={1}
                max={90}
                {...extendTrialForm.register('extensionDays')}
              />
              {extendTrialForm.formState.errors.extensionDays && (
                <p className="text-xs text-destructive">
                  {extendTrialForm.formState.errors.extensionDays.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowExtendTrial(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={extendTrialForm.formState.isSubmitting}>
                {extendTrialForm.formState.isSubmitting ? 'Extending...' : 'Extend Trial'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Billing Period */}
      <Dialog open={showChangeBilling} onOpenChange={setShowChangeBilling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Billing Period</DialogTitle>
            <DialogDescription>
              Switch between monthly and annual billing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={changeBillingForm.handleSubmit(onChangeBilling)} className="space-y-4">
            {changeBillingForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{changeBillingForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>New Billing Period *</Label>
              <Controller
                name="billingPeriod"
                control={changeBillingForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowChangeBilling(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={changeBillingForm.formState.isSubmitting}>
                {changeBillingForm.formState.isSubmitting ? 'Changing...' : 'Change Period'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Expire Trial Confirmation */}
      <AlertDialog open={showExpireTrial} onOpenChange={setShowExpireTrial}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Expire Trial</AlertDialogTitle>
            <AlertDialogDescription>
              Force-expire this trial subscription immediately. The user will lose trial access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onExpireTrial}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Expire Trial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Complimentary */}
      <Dialog open={showRevokeComp} onOpenChange={setShowRevokeComp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke Complimentary Access</DialogTitle>
            <DialogDescription>
              Remove complimentary access from this subscription.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={revokeCompForm.handleSubmit(onRevokeComp)} className="space-y-4">
            {revokeCompForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{revokeCompForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="rc-reason">Reason *</Label>
              <Textarea
                id="rc-reason"
                rows={3}
                placeholder="Reason for revoking..."
                {...revokeCompForm.register('reason')}
              />
              {revokeCompForm.formState.errors.reason && (
                <p className="text-xs text-destructive">
                  {revokeCompForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowRevokeComp(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={revokeCompForm.formState.isSubmitting}>
                {revokeCompForm.formState.isSubmitting ? 'Revoking...' : 'Revoke Access'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Grant Entitlement Override */}
      <Dialog open={showGrantOverride} onOpenChange={setShowGrantOverride}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Grant Entitlement Override</DialogTitle>
            <DialogDescription>
              Add a bonus or override for a specific entitlement.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={grantOverrideForm.handleSubmit(onGrantOverride)} className="space-y-4">
            {grantOverrideForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{grantOverrideForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <input type="hidden" {...grantOverrideForm.register('organizationId')} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Entitlement Key *</Label>
                <Input
                  placeholder="e.g. ai_answers_per_month"
                  {...grantOverrideForm.register('entitlementKey')}
                />
                {grantOverrideForm.formState.errors.entitlementKey && (
                  <p className="text-xs text-destructive">
                    {grantOverrideForm.formState.errors.entitlementKey.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Override Type *</Label>
                <Controller
                  name="overrideType"
                  control={grantOverrideForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bonus_credit">Bonus Credit</SelectItem>
                        <SelectItem value="admin_override">Admin Override</SelectItem>
                        <SelectItem value="promo">Promo</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Numeric Value</Label>
                <Input type="number" {...grantOverrideForm.register('numericValue')} />
              </div>
              <div className="space-y-2">
                <Label>Source Type *</Label>
                <Controller
                  name="sourceType"
                  control={grantOverrideForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="coupon">Coupon</SelectItem>
                        <SelectItem value="promotion">Promotion</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea
                rows={2}
                placeholder="Reason for the override..."
                {...grantOverrideForm.register('reason')}
              />
              {grantOverrideForm.formState.errors.reason && (
                <p className="text-xs text-destructive">
                  {grantOverrideForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Starts At *</Label>
                <Input type="datetime-local" {...grantOverrideForm.register('startsAt')} />
                {grantOverrideForm.formState.errors.startsAt && (
                  <p className="text-xs text-destructive">
                    {grantOverrideForm.formState.errors.startsAt.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Expires At</Label>
                <Input type="datetime-local" {...grantOverrideForm.register('expiresAt')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Source ID (optional)</Label>
              <Input placeholder="UUID" {...grantOverrideForm.register('sourceId')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowGrantOverride(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={grantOverrideForm.formState.isSubmitting}>
                {grantOverrideForm.formState.isSubmitting ? 'Granting...' : 'Grant Override'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke Entitlement Override */}
      <Dialog open={!!revokeOverrideTarget} onOpenChange={(open) => !open && setRevokeOverrideTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke Entitlement Override</DialogTitle>
            <DialogDescription>
              This override will be revoked immediately.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={revokeOverrideForm.handleSubmit(onRevokeOverride)} className="space-y-4">
            {revokeOverrideForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{revokeOverrideForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="ro-reason">Reason *</Label>
              <Textarea
                id="ro-reason"
                rows={3}
                placeholder="Reason for revoking..."
                {...revokeOverrideForm.register('reason')}
              />
              {revokeOverrideForm.formState.errors.reason && (
                <p className="text-xs text-destructive">
                  {revokeOverrideForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRevokeOverrideTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={revokeOverrideForm.formState.isSubmitting}>
                {revokeOverrideForm.formState.isSubmitting ? 'Revoking...' : 'Revoke Override'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
