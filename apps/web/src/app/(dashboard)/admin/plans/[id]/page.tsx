'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Check,
  Eye,
  EyeOff,
  DollarSign,
  ShieldCheck,
  Settings2,
  GitCompareArrows,
} from 'lucide-react';
import Link from 'next/link';

import {
  useAdminPlan,
  useUpdatePlan,
  useCreatePlanPrice,
  useUpdatePlanPrice,
  useDeactivatePlanPrice,
  useCreatePlanEntitlement,
  useUpdatePlanEntitlement,
  useDeletePlanEntitlement,
  useComparePlans,
  useAdminPlans,
} from '@/features/billing/hooks/use-admin-plans';
import { formatPHP } from '@/features/billing/types';
import type {
  PlanType,
  PlanCategory,
  BillingInterval,
  EntitlementValueType,
  PlanPriceDetail,
  PlanEntitlementDetail,
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
import { Separator } from '@/components/ui/separator';
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

// ─── Constants ───────────────────────────────────────────

const PLAN_TYPES: PlanType[] = ['standard', 'trial', 'complimentary', 'custom'];
const PLAN_CATEGORIES: PlanCategory[] = ['individual', 'team', 'academic', 'enterprise'];
const BILLING_INTERVALS: BillingInterval[] = ['monthly', 'annual', 'quarterly', 'one_time'];
const ENTITLEMENT_VALUE_TYPES: EntitlementValueType[] = ['numeric', 'boolean', 'unlimited'];

const intervalLabels: Record<string, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
  quarterly: 'Quarterly',
  one_time: 'One-time',
};

// ─── Schemas ─────────────────────────────────────────────

const updatePlanSchema = z.object({
  name: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
  description: z.string().optional(),
  type: z.enum(['standard', 'trial', 'complimentary', 'custom']),
  category: z.enum(['individual', 'team', 'academic', 'enterprise']).optional(),
  displayOrder: z.coerce.number().min(0).max(9999),
  trialEnabled: z.boolean(),
  trialDurationDays: z.coerce.number().min(1).max(365).optional(),
  maxSeats: z.coerce.number().min(1).optional().or(z.literal('')),
  internalNotes: z.string().optional(),
  isFeatured: z.boolean().optional(),
  featuredLabel: z.string().max(50).optional().or(z.literal('')),
  ctaText: z.string().max(50).optional().or(z.literal('')),
  highlightColor: z.string().max(20).optional().or(z.literal('')),
});

const addPriceSchema = z.object({
  billingInterval: z.enum(['monthly', 'annual', 'quarterly', 'one_time']),
  amount: z.coerce.number().min(0, 'Amount must be 0 or greater'),
  currency: z.string().default('PHP'),
});

const editPriceSchema = z.object({
  amount: z.coerce.number().min(0),
});

const addEntitlementSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100),
  valueType: z.enum(['numeric', 'boolean', 'unlimited']),
  numericValue: z.coerce.number().optional(),
  booleanValue: z.boolean().optional(),
  description: z.string().optional(),
});

const editEntitlementSchema = z.object({
  valueType: z.enum(['numeric', 'boolean', 'unlimited']),
  numericValue: z.coerce.number().optional(),
  booleanValue: z.boolean().optional(),
  description: z.string().optional(),
});

// ─── Page ────────────────────────────────────────────────

export default function AdminPlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.id as string;

  const { data: plan, isLoading, error } = useAdminPlan(planId);
  const { data: allPlans } = useAdminPlans();
  const updatePlan = useUpdatePlan();

  // Price mutations
  const createPrice = useCreatePlanPrice();
  const updatePrice = useUpdatePlanPrice();
  const deactivatePrice = useDeactivatePlanPrice();

  // Entitlement mutations
  const createEntitlement = useCreatePlanEntitlement();
  const updateEntitlement = useUpdatePlanEntitlement();
  const deleteEntitlement = useDeletePlanEntitlement();

  // State
  const [editingPlan, setEditingPlan] = useState(false);
  const [showAddPrice, setShowAddPrice] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PlanPriceDetail | null>(null);
  const [deactivatingPrice, setDeactivatingPrice] = useState<PlanPriceDetail | null>(null);
  const [showAddEntitlement, setShowAddEntitlement] = useState(false);
  const [editingEntitlement, setEditingEntitlement] = useState<PlanEntitlementDetail | null>(null);
  const [deletingEntitlement, setDeletingEntitlement] = useState<PlanEntitlementDetail | null>(null);
  const [compareWith, setCompareWith] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Compare hook
  const { data: comparison } = useComparePlans(
    plan?.code ?? '',
    compareWith,
  );

  // Plan edit form
  const planForm = useForm({
    resolver: zodResolver(updatePlanSchema),
    values: plan
      ? {
          name: plan.name,
          displayName: plan.displayName ?? '',
          description: plan.description ?? '',
          type: plan.type as PlanType,
          category: (plan.category as PlanCategory) ?? undefined,
          displayOrder: plan.displayOrder,
          trialEnabled: plan.trialEnabled,
          trialDurationDays: plan.trialDurationDays || undefined,
          maxSeats: plan.maxSeats ?? ('' as const),
          internalNotes: plan.internalNotes ?? '',
          isFeatured: plan.isFeatured ?? false,
          featuredLabel: plan.featuredLabel ?? '',
          ctaText: plan.ctaText ?? '',
          highlightColor: plan.highlightColor ?? '',
        }
      : undefined,
  });

  // Price forms
  const addPriceForm = useForm({
    resolver: zodResolver(addPriceSchema),
    defaultValues: { billingInterval: 'monthly' as const, amount: 0, currency: 'PHP' },
  });
  const editPriceForm = useForm({
    resolver: zodResolver(editPriceSchema),
  });

  // Entitlement forms
  const addEntitlementForm = useForm({
    resolver: zodResolver(addEntitlementSchema),
    defaultValues: { valueType: 'numeric' as const, booleanValue: true },
  });
  const editEntitlementForm = useForm({
    resolver: zodResolver(editEntitlementSchema),
  });

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // ─── Handlers ──────────────────────────────────────────

  const onUpdatePlan = async (data: z.infer<typeof updatePlanSchema>) => {
    try {
      await updatePlan.mutateAsync({
        id: planId,
        data: {
          ...data,
          maxSeats: data.maxSeats === '' ? undefined : data.maxSeats ? Number(data.maxSeats) : undefined,
        },
      });
      setEditingPlan(false);
      flash('Plan updated.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        planForm.setError('root', { message: err.message });
      }
    }
  };

  const onAddPrice = async (data: z.infer<typeof addPriceSchema>) => {
    try {
      await createPrice.mutateAsync({ planId, data });
      setShowAddPrice(false);
      addPriceForm.reset();
      flash('Price added.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        addPriceForm.setError('root', { message: err.message });
      }
    }
  };

  const onEditPrice = async (data: z.infer<typeof editPriceSchema>) => {
    if (!editingPrice) return;
    try {
      await updatePrice.mutateAsync({
        planId,
        priceId: editingPrice.id,
        data: { amount: data.amount },
      });
      setEditingPrice(null);
      flash('Price updated.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        editPriceForm.setError('root', { message: err.message });
      }
    }
  };

  const onDeactivatePrice = async () => {
    if (!deactivatingPrice) return;
    await deactivatePrice.mutateAsync({
      planId,
      priceId: deactivatingPrice.id,
    });
    setDeactivatingPrice(null);
    flash('Price deactivated.');
  };

  const onAddEntitlement = async (data: z.infer<typeof addEntitlementSchema>) => {
    try {
      await createEntitlement.mutateAsync({ planId, data });
      setShowAddEntitlement(false);
      addEntitlementForm.reset({ valueType: 'numeric', booleanValue: true });
      flash('Entitlement added.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        addEntitlementForm.setError('root', { message: err.message });
      }
    }
  };

  const onEditEntitlement = async (data: z.infer<typeof editEntitlementSchema>) => {
    if (!editingEntitlement) return;
    try {
      await updateEntitlement.mutateAsync({
        planId,
        entitlementId: editingEntitlement.id,
        data,
      });
      setEditingEntitlement(null);
      flash('Entitlement updated.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        editEntitlementForm.setError('root', { message: err.message });
      }
    }
  };

  const onDeleteEntitlement = async () => {
    if (!deletingEntitlement) return;
    await deleteEntitlement.mutateAsync({
      planId,
      entitlementId: deletingEntitlement.id,
    });
    setDeletingEntitlement(null);
    flash('Entitlement deleted.');
  };

  const onToggleActive = async () => {
    if (!plan) return;
    await updatePlan.mutateAsync({
      id: planId,
      data: { isActive: !plan.isActive },
    });
    flash(plan.isActive ? 'Plan deactivated.' : 'Plan activated.');
  };

  const onToggleVisible = async () => {
    if (!plan) return;
    await updatePlan.mutateAsync({
      id: planId,
      data: { isVisible: !plan.isVisible },
    });
    flash(plan.isVisible ? 'Plan hidden.' : 'Plan made visible.');
  };

  // ─── Render ────────────────────────────────────────────

  if (isLoading) return <AdminListSkeleton />;

  if (error || !plan) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" asChild>
          <Link href="/admin/plans">
            <ArrowLeft className="mr-2 size-4" />
            Back to Plans
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Plan not found or failed to load.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const addEntVT = addEntitlementForm.watch('valueType');
  const editEntVT = editEntitlementForm.watch('valueType');

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/plans">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{plan.displayName || plan.name}</h1>
              <Badge variant="outline" className="font-mono">
                {plan.code}
              </Badge>
              {plan.isActive ? (
                <Badge className="bg-green-100 text-green-700">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
              {plan.isVisible ? (
                <Badge className="bg-blue-100 text-blue-700">
                  <Eye className="mr-1 size-3" /> Visible
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <EyeOff className="mr-1 size-3" /> Hidden
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {plan.type} / {plan.category} plan
              {plan.trialEnabled && ` / ${plan.trialDurationDays}-day trial`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onToggleVisible}>
            {plan.isVisible ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
            {plan.isVisible ? 'Hide' : 'Show'}
          </Button>
          <Button
            variant={plan.isActive ? 'outline' : 'default'}
            onClick={onToggleActive}
          >
            {plan.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
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
          <TabsTrigger value="prices">
            <DollarSign className="mr-1.5 size-4" /> Prices ({plan.prices.length})
          </TabsTrigger>
          <TabsTrigger value="entitlements">
            <ShieldCheck className="mr-1.5 size-4" /> Entitlements ({plan.entitlements.length})
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="mr-1.5 size-4" /> Compare
          </TabsTrigger>
        </TabsList>

        {/* ─── Details Tab ─────────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Plan Information</CardTitle>
              {!editingPlan ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingPlan(true)}
                >
                  <Pencil className="mr-2 size-4" /> Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingPlan(false);
                      planForm.reset();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={planForm.handleSubmit(onUpdatePlan)}
                    disabled={planForm.formState.isSubmitting}
                  >
                    <Save className="mr-2 size-4" /> Save
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {planForm.formState.errors.root && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    {planForm.formState.errors.root.message}
                  </AlertDescription>
                </Alert>
              )}

              {editingPlan ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input {...planForm.register('name')} />
                    </div>
                    <div className="space-y-2">
                      <Label>Display Name</Label>
                      <Input {...planForm.register('displayName')} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea rows={2} {...planForm.register('description')} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Controller
                        name="type"
                        control={planForm.control}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PLAN_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Controller
                        name="category"
                        control={planForm.control}
                        render={({ field }) => (
                          <Select
                            value={field.value ?? ''}
                            onValueChange={(v) => field.onChange(v || undefined)}
                          >
                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {PLAN_CATEGORIES.map((c) => (
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
                      <Label>Display Order</Label>
                      <Input type="number" {...planForm.register('displayOrder')} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Seats</Label>
                      <Input type="number" min={1} placeholder="Unlimited" {...planForm.register('maxSeats')} />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 pt-6">
                        <Controller
                          name="trialEnabled"
                          control={planForm.control}
                          render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          )}
                        />
                        <Label>Trial Enabled</Label>
                      </div>
                    </div>
                  </div>
                  {planForm.watch('trialEnabled') && (
                    <div className="space-y-2">
                      <Label>Trial Duration (days)</Label>
                      <Input type="number" min={1} max={365} {...planForm.register('trialDurationDays')} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Internal Notes</Label>
                    <Textarea rows={2} {...planForm.register('internalNotes')} />
                  </div>
                  <Separator />
                  <p className="text-sm font-medium text-muted-foreground">Pricing Page Display</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Controller
                          name="isFeatured"
                          control={planForm.control}
                          render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          )}
                        />
                        <Label>Featured on Pricing Page</Label>
                      </div>
                    </div>
                    {planForm.watch('isFeatured') && (
                      <div className="space-y-2">
                        <Label>Featured Badge Label</Label>
                        <Input placeholder="Most Popular" {...planForm.register('featuredLabel')} />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>CTA Button Text</Label>
                      <Input placeholder="Start Now" {...planForm.register('ctaText')} />
                    </div>
                    <div className="space-y-2">
                      <Label>Highlight Color</Label>
                      <Controller
                        name="highlightColor"
                        control={planForm.control}
                        render={({ field }) => (
                          <Select
                            value={field.value || 'default'}
                            onValueChange={(v) => field.onChange(v === 'default' ? '' : v)}
                          >
                            <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default</SelectItem>
                              <SelectItem value="primary">Primary (dark)</SelectItem>
                              <SelectItem value="emerald">Emerald</SelectItem>
                              <SelectItem value="amber">Amber</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow label="Name" value={plan.name} />
                  <InfoRow label="Display Name" value={plan.displayName || '—'} />
                  <InfoRow label="Description" value={plan.description || '—'} className="sm:col-span-2" />
                  <InfoRow label="Type" value={plan.type} />
                  <InfoRow label="Category" value={plan.category} />
                  <InfoRow label="Display Order" value={String(plan.displayOrder)} />
                  <InfoRow label="Max Seats" value={plan.maxSeats ? String(plan.maxSeats) : 'Unlimited'} />
                  <InfoRow label="Default Seats" value={String(plan.defaultSeats)} />
                  <InfoRow label="Trial" value={plan.trialEnabled ? `${plan.trialDurationDays} days` : 'Disabled'} />
                  <InfoRow label="Grace Period" value={`${plan.gracePeriodDays} days`} />
                  <InfoRow label="Auto Renew" value={plan.autoRenewRequired ? 'Yes' : 'No'} />
                  <InfoRow label="Admin Only" value={plan.adminOnlyAssignment ? 'Yes' : 'No'} />
                  <InfoRow label="Invite Only" value={plan.inviteOnly ? 'Yes' : 'No'} />
                  <InfoRow label="Featured" value={plan.isFeatured ? (plan.featuredLabel ?? 'Yes') : 'No'} />
                  <InfoRow label="CTA Text" value={plan.ctaText ?? '—'} />
                  <InfoRow label="Highlight Color" value={plan.highlightColor ?? 'default'} />
                  {plan.internalNotes && (
                    <InfoRow label="Internal Notes" value={plan.internalNotes} className="sm:col-span-2" />
                  )}
                  <InfoRow label="Created" value={new Date(plan.createdAt).toLocaleDateString()} />
                  <InfoRow label="Updated" value={new Date(plan.updatedAt).toLocaleDateString()} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Prices Tab ──────────────────────────────── */}
        <TabsContent value="prices" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Price Tiers</CardTitle>
                <CardDescription>
                  Manage billing interval prices for this plan.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddPrice(true)}>
                <Plus className="mr-2 size-4" /> Add Price
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interval</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.prices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No prices configured. Add a price tier.
                      </TableCell>
                    </TableRow>
                  ) : (
                    plan.prices.map((price) => (
                      <TableRow key={price.id}>
                        <TableCell>
                          <Badge variant="outline">
                            {intervalLabels[price.billingInterval] ?? price.billingInterval}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-lg font-semibold">
                          {formatPHP(price.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {price.currency}
                        </TableCell>
                        <TableCell className="text-center">
                          {price.isActive ? (
                            <Badge className="bg-green-100 text-green-700">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => {
                                setEditingPrice(price);
                                editPriceForm.reset({ amount: price.amount });
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            {price.isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive"
                                onClick={() => setDeactivatingPrice(price)}
                              >
                                <X className="size-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Entitlements Tab ─────────────────────────── */}
        <TabsContent value="entitlements" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Entitlements</CardTitle>
                <CardDescription>
                  Define what this plan includes — quotas, features, and limits.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddEntitlement(true)}>
                <Plus className="mr-2 size-4" /> Add Entitlement
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.entitlements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No entitlements configured. Add one.
                      </TableCell>
                    </TableRow>
                  ) : (
                    plan.entitlements.map((ent) => (
                      <TableRow key={ent.id}>
                        <TableCell className="font-mono text-sm">{ent.key}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{ent.valueType}</Badge>
                        </TableCell>
                        <TableCell className="font-semibold">
                          {ent.valueType === 'numeric' && ent.numericValue !== null
                            ? ent.numericValue.toLocaleString()
                            : ent.valueType === 'boolean'
                              ? ent.booleanValue
                                ? 'Yes'
                                : 'No'
                              : 'Unlimited'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                          {ent.description || '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => {
                                setEditingEntitlement(ent);
                                editEntitlementForm.reset({
                                  valueType: ent.valueType,
                                  numericValue: ent.numericValue ?? undefined,
                                  booleanValue: ent.booleanValue ?? true,
                                  description: ent.description ?? '',
                                });
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive"
                              onClick={() => setDeletingEntitlement(ent)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Compare Tab ─────────────────────────────── */}
        <TabsContent value="compare" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compare Entitlements</CardTitle>
              <CardDescription>
                Compare this plan&apos;s entitlements with another plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label>Compare with</Label>
                  <Select value={compareWith} onValueChange={setCompareWith}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select plan..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allPlans
                        ?.filter((p) => p.code !== plan.code)
                        .map((p) => (
                          <SelectItem key={p.code} value={p.code}>
                            {p.displayName || p.name} ({p.code})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {comparison && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entitlement</TableHead>
                      <TableHead>{comparison.from.name}</TableHead>
                      <TableHead>{comparison.to.name}</TableHead>
                      <TableHead>Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.entitlements.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-mono text-sm">{row.key}</TableCell>
                        <TableCell>{formatEntValue(row.fromValue)}</TableCell>
                        <TableCell>{formatEntValue(row.toValue)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={changeColors[row.change] ?? ''}
                          >
                            {row.change}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {!compareWith && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Select a plan to compare entitlements.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ──────────────────────────────────── */}

      {/* Add Price Dialog */}
      <Dialog open={showAddPrice} onOpenChange={setShowAddPrice}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Price Tier</DialogTitle>
            <DialogDescription>Add a new billing interval price.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addPriceForm.handleSubmit(onAddPrice)} className="space-y-4">
            {addPriceForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{addPriceForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Billing Interval</Label>
              <Controller
                name="billingInterval"
                control={addPriceForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BILLING_INTERVALS.map((i) => (
                        <SelectItem key={i} value={i}>{intervalLabels[i]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount (centavos)</Label>
              <Input type="number" min={0} {...addPriceForm.register('amount')} />
              <p className="text-xs text-muted-foreground">
                e.g. 99900 = ₱999.00
              </p>
              {addPriceForm.formState.errors.amount && (
                <p className="text-xs text-destructive">{addPriceForm.formState.errors.amount.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddPrice(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addPriceForm.formState.isSubmitting}>
                Add Price
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Price Dialog */}
      <Dialog open={!!editingPrice} onOpenChange={(o) => !o && setEditingPrice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit Price — {editingPrice && intervalLabels[editingPrice.billingInterval]}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={editPriceForm.handleSubmit(onEditPrice)} className="space-y-4">
            {editPriceForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{editPriceForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Amount (centavos)</Label>
              <Input type="number" min={0} {...editPriceForm.register('amount')} />
              <p className="text-xs text-muted-foreground">
                Current: {editingPrice ? formatPHP(editingPrice.amount) : ''}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingPrice(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editPriceForm.formState.isSubmitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Price */}
      <AlertDialog open={!!deactivatingPrice} onOpenChange={(o) => !o && setDeactivatingPrice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Price</AlertDialogTitle>
            <AlertDialogDescription>
              Deactivate the{' '}
              <strong>
                {deactivatingPrice && intervalLabels[deactivatingPrice.billingInterval]}
              </strong>{' '}
              price of {deactivatingPrice ? formatPHP(deactivatingPrice.amount) : ''}?
              Existing subscribers will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeactivatePrice}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Entitlement Dialog */}
      <Dialog open={showAddEntitlement} onOpenChange={setShowAddEntitlement}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Entitlement</DialogTitle>
            <DialogDescription>Define a quota, feature, or limit.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addEntitlementForm.handleSubmit(onAddEntitlement)} className="space-y-4">
            {addEntitlementForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{addEntitlementForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Key</Label>
              <Input placeholder="e.g. ai_answers_per_month" {...addEntitlementForm.register('key')} />
              {addEntitlementForm.formState.errors.key && (
                <p className="text-xs text-destructive">{addEntitlementForm.formState.errors.key.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Value Type</Label>
              <Controller
                name="valueType"
                control={addEntitlementForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENTITLEMENT_VALUE_TYPES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            {addEntVT === 'numeric' && (
              <div className="space-y-2">
                <Label>Numeric Value</Label>
                <Input type="number" {...addEntitlementForm.register('numericValue')} />
              </div>
            )}
            {addEntVT === 'boolean' && (
              <div className="flex items-center gap-2">
                <Controller
                  name="booleanValue"
                  control={addEntitlementForm.control}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
                <Label>Enabled</Label>
              </div>
            )}
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Shown on pricing page" {...addEntitlementForm.register('description')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddEntitlement(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addEntitlementForm.formState.isSubmitting}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Entitlement Dialog */}
      <Dialog open={!!editingEntitlement} onOpenChange={(o) => !o && setEditingEntitlement(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit Entitlement — <span className="font-mono">{editingEntitlement?.key}</span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={editEntitlementForm.handleSubmit(onEditEntitlement)} className="space-y-4">
            {editEntitlementForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{editEntitlementForm.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Value Type</Label>
              <Controller
                name="valueType"
                control={editEntitlementForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENTITLEMENT_VALUE_TYPES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            {editEntVT === 'numeric' && (
              <div className="space-y-2">
                <Label>Numeric Value</Label>
                <Input type="number" {...editEntitlementForm.register('numericValue')} />
              </div>
            )}
            {editEntVT === 'boolean' && (
              <div className="flex items-center gap-2">
                <Controller
                  name="booleanValue"
                  control={editEntitlementForm.control}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
                <Label>Enabled</Label>
              </div>
            )}
            <div className="space-y-2">
              <Label>Description</Label>
              <Input {...editEntitlementForm.register('description')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingEntitlement(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editEntitlementForm.formState.isSubmitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Entitlement */}
      <AlertDialog open={!!deletingEntitlement} onOpenChange={(o) => !o && setDeletingEntitlement(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entitlement</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong className="font-mono">{deletingEntitlement?.key}</strong> from
              this plan? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteEntitlement}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function InfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function formatEntValue(val: string | number | boolean | null): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

const changeColors: Record<string, string> = {
  added: 'bg-green-100 text-green-700',
  removed: 'bg-red-100 text-red-700',
  upgraded: 'bg-blue-100 text-blue-700',
  downgraded: 'bg-amber-100 text-amber-700',
  unchanged: '',
};
