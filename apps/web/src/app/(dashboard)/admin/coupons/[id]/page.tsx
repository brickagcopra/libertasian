'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  Pencil,
  Save,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Users,
  Building2,
  ClipboardList,
  Settings2,
  History,
  Shield,
} from 'lucide-react';
import Link from 'next/link';

import {
  useAdminCoupon,
  useUpdateCoupon,
  useActivateCoupon,
  useDeactivateCoupon,
  useCouponRedemptions,
  useSetCouponPlanRules,
} from '@/features/billing/hooks/use-admin-coupons';
import { formatPHP } from '@/features/billing/types';
import type {
  CouponDiscountType,
  CouponRedemptionStatus,
  CouponPlanRuleType,
  SetCouponPlanRuleInput,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// ─── Constants ───────────────────────────────────────────

const discountTypeLabels: Record<string, string> = {
  percentage: 'Percentage',
  fixed_amount: 'Fixed Amount',
  bonus_credit: 'Bonus Credit',
  trial_extension: 'Trial Extension',
};

const discountTypeColors: Record<string, string> = {
  percentage: 'bg-blue-100 text-blue-700',
  fixed_amount: 'bg-green-100 text-green-700',
  bonus_credit: 'bg-purple-100 text-purple-700',
  trial_extension: 'bg-amber-100 text-amber-700',
};

const redemptionStatusColors: Record<string, string> = {
  reserved: 'bg-yellow-100 text-yellow-700',
  redeemed: 'bg-green-100 text-green-700',
  rolled_back: 'bg-red-100 text-red-700',
  expired: 'bg-muted text-muted-foreground',
};

const PLAN_CODES = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;

// ─── Schemas ─────────────────────────────────────────────

const updateCouponSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  internalNotes: z.string().max(1000).optional(),
  appliesToBillingPeriod: z.enum(['any', 'monthly', 'annual']),
  maxRedemptions: z.coerce.number().min(1).optional().or(z.literal('')),
  maxRedemptionsPerOrg: z.coerce.number().min(1),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  minimumPlanTier: z.string().optional(),
});

const planRuleSchema = z.object({
  planCode: z.string().min(1),
  ruleType: z.enum(['include', 'exclude']),
});

// ─── Helpers ─────────────────────────────────────────────

function formatDiscountValue(type: string, value: number): string {
  switch (type) {
    case 'percentage':
      return `${value}%`;
    case 'fixed_amount':
      return formatPHP(value);
    case 'bonus_credit':
      return `+${value} credits`;
    case 'trial_extension':
      return `+${value} days`;
    default:
      return String(value);
  }
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toISOString().slice(0, 16);
}

// ─── Page ────────────────────────────────────────────────

export default function AdminCouponDetailPage() {
  const params = useParams();
  const couponId = params.id as string;

  const { data: coupon, isLoading, error } = useAdminCoupon(couponId);
  const updateCoupon = useUpdateCoupon();
  const activateCoupon = useActivateCoupon();
  const deactivateCoupon = useDeactivateCoupon();
  const { data: redemptionsRes } = useCouponRedemptions(couponId);
  const setPlanRules = useSetCouponPlanRules();

  const [editing, setEditing] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const redemptions = redemptionsRes?.data ?? [];

  const editForm = useForm({
    resolver: zodResolver(updateCouponSchema),
    values: coupon
      ? {
          name: coupon.name,
          description: coupon.description ?? '',
          internalNotes: coupon.internalNotes ?? '',
          appliesToBillingPeriod: coupon.appliesToBillingPeriod as 'any' | 'monthly' | 'annual',
          maxRedemptions: coupon.maxRedemptions ?? ('' as const),
          maxRedemptionsPerOrg: coupon.maxRedemptionsPerOrg,
          startsAt: toLocalDatetime(coupon.startsAt),
          expiresAt: toLocalDatetime(coupon.expiresAt),
          minimumPlanTier: coupon.minimumPlanTier ?? '',
        }
      : undefined,
  });

  const ruleForm = useForm({
    resolver: zodResolver(planRuleSchema),
    defaultValues: { planCode: '', ruleType: 'include' as const },
  });

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const onUpdate = async (data: z.infer<typeof updateCouponSchema>) => {
    try {
      await updateCoupon.mutateAsync({
        id: couponId,
        data: {
          ...data,
          maxRedemptions: data.maxRedemptions === '' ? undefined : data.maxRedemptions ? Number(data.maxRedemptions) : undefined,
          startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : undefined,
          expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : undefined,
          minimumPlanTier: data.minimumPlanTier || undefined,
        },
      });
      setEditing(false);
      flash('Coupon updated.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        editForm.setError('root', { message: err.message });
      }
    }
  };

  const onAddPlanRule = async (data: z.infer<typeof planRuleSchema>) => {
    const existingRules = coupon?.planRules ?? [];
    const newRules: SetCouponPlanRuleInput[] = [
      ...existingRules.map((r) => ({ planCode: r.planCode, ruleType: r.ruleType })),
      { planCode: data.planCode, ruleType: data.ruleType as CouponPlanRuleType },
    ];
    await setPlanRules.mutateAsync({ couponId, rules: newRules });
    setShowAddRule(false);
    ruleForm.reset();
    flash('Plan rule added.');
  };

  const onRemovePlanRule = async (planCode: string) => {
    const existingRules = coupon?.planRules ?? [];
    const newRules = existingRules
      .filter((r) => r.planCode !== planCode)
      .map((r) => ({ planCode: r.planCode, ruleType: r.ruleType }));
    await setPlanRules.mutateAsync({ couponId, rules: newRules });
    flash('Plan rule removed.');
  };

  if (isLoading) return <AdminListSkeleton />;

  if (error || !coupon) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" asChild>
          <Link href="/admin/coupons">
            <ArrowLeft className="mr-2 size-4" /> Back to Coupons
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Coupon not found or failed to load.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/coupons">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold font-mono">{coupon.code}</h1>
              <Badge
                variant="secondary"
                className={discountTypeColors[coupon.discountType] ?? ''}
              >
                {discountTypeLabels[coupon.discountType]}
              </Badge>
              {coupon.isArchived ? (
                <Badge variant="secondary">Archived</Badge>
              ) : coupon.isActive ? (
                <Badge className="bg-green-100 text-green-700">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {coupon.name} &mdash;{' '}
              {formatDiscountValue(coupon.discountType, coupon.discountValue)}
            </p>
          </div>
        </div>
        {!coupon.isArchived && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                coupon.isActive
                  ? deactivateCoupon.mutate(couponId)
                  : activateCoupon.mutate(couponId)
              }
            >
              {coupon.isActive ? (
                <>
                  <PowerOff className="mr-2 size-4" /> Deactivate
                </>
              ) : (
                <>
                  <Power className="mr-2 size-4" /> Activate
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {successMsg && (
        <Alert>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">
            <Settings2 className="mr-1.5 size-4" /> Details
          </TabsTrigger>
          <TabsTrigger value="redemptions">
            <History className="mr-1.5 size-4" /> Redemptions ({coupon.currentRedemptions})
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Shield className="mr-1.5 size-4" /> Plan Rules ({coupon.planRules?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* ─── Details Tab ──────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Coupon Details</CardTitle>
              {!editing ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="mr-2 size-4" /> Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(false); editForm.reset(); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={editForm.handleSubmit(onUpdate)} disabled={editForm.formState.isSubmitting}>
                    <Save className="mr-2 size-4" /> Save
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {editForm.formState.errors.root && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{editForm.formState.errors.root.message}</AlertDescription>
                </Alert>
              )}

              {editing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input {...editForm.register('name')} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea rows={2} {...editForm.register('description')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Billing Period</Label>
                      <Controller
                        name="appliesToBillingPeriod"
                        control={editForm.control}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="annual">Annual</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Min Plan Tier</Label>
                      <Controller
                        name="minimumPlanTier"
                        control={editForm.control}
                        render={({ field }) => (
                          <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                            <SelectContent>
                              {PLAN_CODES.map((c) => (
                                <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Redemptions</Label>
                      <Input type="number" min={1} placeholder="Unlimited" {...editForm.register('maxRedemptions')} />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Per Org</Label>
                      <Input type="number" min={1} {...editForm.register('maxRedemptionsPerOrg')} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Starts At</Label>
                      <Input type="datetime-local" {...editForm.register('startsAt')} />
                    </div>
                    <div className="space-y-2">
                      <Label>Expires At</Label>
                      <Input type="datetime-local" {...editForm.register('expiresAt')} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Internal Notes</Label>
                    <Textarea rows={2} {...editForm.register('internalNotes')} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow label="Code" value={coupon.code} />
                  <InfoRow label="Name" value={coupon.name} />
                  <InfoRow label="Description" value={coupon.description || '—'} className="sm:col-span-2" />
                  <InfoRow label="Discount Type" value={discountTypeLabels[coupon.discountType] ?? coupon.discountType} />
                  <InfoRow label="Discount Value" value={formatDiscountValue(coupon.discountType, coupon.discountValue)} />
                  <InfoRow label="Currency" value={coupon.currency} />
                  <InfoRow label="Billing Period" value={coupon.appliesToBillingPeriod} />
                  <InfoRow label="Max Redemptions" value={coupon.maxRedemptions ? String(coupon.maxRedemptions) : 'Unlimited'} />
                  <InfoRow label="Max Per Org" value={String(coupon.maxRedemptionsPerOrg)} />
                  <InfoRow label="Current Redemptions" value={String(coupon.currentRedemptions)} />
                  <InfoRow label="Min Plan Tier" value={coupon.minimumPlanTier || 'None'} />
                  <InfoRow label="Starts At" value={coupon.startsAt ? new Date(coupon.startsAt).toLocaleString() : 'Immediately'} />
                  <InfoRow label="Expires At" value={coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString() : 'Never'} />
                  {coupon.bonusEntitlementKey && (
                    <>
                      <InfoRow label="Bonus Key" value={coupon.bonusEntitlementKey} />
                      <InfoRow label="Bonus Value" value={String(coupon.bonusEntitlementValue ?? '—')} />
                      <InfoRow label="Bonus Duration" value={coupon.bonusDurationDays ? `${coupon.bonusDurationDays} days` : '—'} />
                    </>
                  )}
                  {coupon.trialExtensionDays && (
                    <InfoRow label="Trial Extension" value={`${coupon.trialExtensionDays} days`} />
                  )}
                  {coupon.internalNotes && (
                    <InfoRow label="Internal Notes" value={coupon.internalNotes} className="sm:col-span-2" />
                  )}
                  <InfoRow label="Created" value={new Date(coupon.createdAt).toLocaleDateString()} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Redemptions Tab ──────────────────────── */}
        <TabsContent value="redemptions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Redemption History</CardTitle>
              <CardDescription>
                {coupon.currentRedemptions} total redemption{coupon.currentRedemptions !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Discount Applied</TableHead>
                    <TableHead>Reserved</TableHead>
                    <TableHead>Redeemed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redemptions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No redemptions yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    redemptions.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={redemptionStatusColors[r.status] ?? ''}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.organizationId.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.userId.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          {r.discountAmountApplied !== null
                            ? formatPHP(r.discountAmountApplied)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(r.reservedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.redeemedAt
                            ? new Date(r.redeemedAt).toLocaleString()
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Plan Rules Tab ──────────────────────── */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Plan Rules</CardTitle>
                <CardDescription>
                  Control which plans this coupon applies to.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddRule(true)}>
                <Plus className="mr-2 size-4" /> Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Rule Type</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!coupon.planRules || coupon.planRules.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        No plan rules. Coupon applies to all plans.
                      </TableCell>
                    </TableRow>
                  ) : (
                    coupon.planRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-mono">{rule.planCode}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              rule.ruleType === 'include'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }
                          >
                            {rule.ruleType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive"
                            onClick={() => onRemovePlanRule(rule.planCode)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Plan Rule Dialog */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Plan Rule</DialogTitle>
            <DialogDescription>Include or exclude a plan for this coupon.</DialogDescription>
          </DialogHeader>
          <form onSubmit={ruleForm.handleSubmit(onAddPlanRule)} className="space-y-4">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Controller
                name="planCode"
                control={ruleForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select plan..." /></SelectTrigger>
                    <SelectContent>
                      {PLAN_CODES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>Rule Type</Label>
              <Controller
                name="ruleType"
                control={ruleForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">Include (only these plans)</SelectItem>
                      <SelectItem value="exclude">Exclude (all except these)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
              <Button type="submit" disabled={ruleForm.formState.isSubmitting}>Add Rule</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function InfoRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
