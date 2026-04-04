'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Search,
  MoreHorizontal,
  Check,
  X,
  Archive,
  Power,
  PowerOff,
  TicketIcon,
  CalendarIcon,
} from 'lucide-react';

import {
  useAdminCoupons,
  useCreateCoupon,
  useArchiveCoupon,
  useActivateCoupon,
  useDeactivateCoupon,
} from '@/features/billing/hooks/use-admin-coupons';
import { formatPHP } from '@/features/billing/types';
import type { CouponDiscountType, ListCouponsQuery } from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Constants ───────────────────────────────────────────

const DISCOUNT_TYPES: CouponDiscountType[] = [
  'percentage',
  'fixed_amount',
  'bonus_credit',
  'trial_extension',
];

const discountTypeColors: Record<string, string> = {
  percentage: 'bg-blue-100 text-blue-700',
  fixed_amount: 'bg-green-100 text-green-700',
  bonus_credit: 'bg-purple-100 text-purple-700',
  trial_extension: 'bg-amber-100 text-amber-700',
};

const discountTypeLabels: Record<string, string> = {
  percentage: 'Percentage',
  fixed_amount: 'Fixed Amount',
  bonus_credit: 'Bonus Credit',
  trial_extension: 'Trial Extension',
};

const PLAN_TIERS = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;

// ─── Create Coupon Schema ────────────────────────────────

const createCouponSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Alphanumeric, dashes, underscores only'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  internalNotes: z.string().max(1000).optional(),
  discountType: z.enum(['percentage', 'fixed_amount', 'bonus_credit', 'trial_extension']),
  discountValue: z.coerce.number().min(1, 'Value must be at least 1'),
  currency: z.string().max(3).optional(),
  appliesToBillingPeriod: z.enum(['any', 'monthly', 'annual']).optional(),
  maxRedemptions: z.coerce.number().min(1).optional().or(z.literal('')),
  maxRedemptionsPerOrg: z.coerce.number().min(1).optional(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  minimumPlanTier: z.string().optional(),
  bonusEntitlementKey: z.string().max(100).optional(),
  bonusEntitlementValue: z.coerce.number().min(1).optional(),
  bonusDurationDays: z.coerce.number().min(1).max(3650).optional(),
  trialExtensionDays: z.coerce.number().min(1).max(365).optional(),
  isActive: z.boolean().optional(),
});

type CreateCouponForm = z.infer<typeof createCouponSchema>;

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

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ─── Page ────────────────────────────────────────────────

export default function AdminCouponsPage() {
  const [queryParams, setQueryParams] = useState<ListCouponsQuery>({
    sortBy: 'createdAt',
    sortDir: 'desc',
  });
  const { data: response, isLoading, error } = useAdminCoupons(queryParams);
  const createCoupon = useCreateCoupon();
  const archiveCoupon = useArchiveCoupon();
  const activateCoupon = useActivateCoupon();
  const deactivateCoupon = useDeactivateCoupon();

  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; code: string } | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const coupons = response?.data ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors, isSubmitting },
    reset,
    setError,
    control,
    watch,
  } = useForm<CreateCouponForm>({
    resolver: zodResolver(createCouponSchema),
    defaultValues: {
      discountType: 'percentage',
      appliesToBillingPeriod: 'any',
      maxRedemptionsPerOrg: 1,
      isActive: true,
      currency: 'PHP',
    },
  });

  const discountType = watch('discountType');

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const onSearch = () => {
    setQueryParams((prev) => ({ ...prev, search: searchInput || undefined, cursor: undefined }));
  };

  const onCreateSubmit = async (data: CreateCouponForm) => {
    try {
      const payload = {
        ...data,
        code: data.code.toUpperCase(),
        maxRedemptions: data.maxRedemptions === '' ? undefined : data.maxRedemptions ? Number(data.maxRedemptions) : undefined,
        startsAt: data.startsAt || undefined,
        expiresAt: data.expiresAt || undefined,
        minimumPlanTier: data.minimumPlanTier || undefined,
        bonusEntitlementKey: data.bonusEntitlementKey || undefined,
        bonusEntitlementValue: data.bonusEntitlementValue || undefined,
        bonusDurationDays: data.bonusDurationDays || undefined,
        trialExtensionDays: data.trialExtensionDays || undefined,
      };
      await createCoupon.mutateAsync(payload);
      setShowCreate(false);
      reset();
      flash('Coupon created successfully.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      }
    }
  };

  const onArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archiveCoupon.mutateAsync(archiveTarget.id);
      setArchiveTarget(null);
      flash(`Coupon "${archiveTarget.code}" archived.`);
    } catch {
      // mutation error state handles display
    }
  };

  if (isLoading) return <AdminListSkeleton />;

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Coupon Management</h1>
        <Alert variant="destructive">
          <AlertDescription>Failed to load coupons. Please try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Coupon Management</h1>
          <p className="text-sm text-muted-foreground">
            {coupons.length} coupon{coupons.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 size-4" />
          Create Coupon
        </Button>
      </div>

      {successMsg && (
        <Alert>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {coupons.filter((c) => c.isActive && !c.isArchived).length}
            </p>
            <p className="text-xs text-muted-foreground">Active Coupons</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {coupons.reduce((sum, c) => sum + c.currentRedemptions, 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Redemptions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {coupons.filter((c) => c.expiresAt && isExpired(c.expiresAt)).length}
            </p>
            <p className="text-xs text-muted-foreground">Expired</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {coupons.filter((c) => c.isArchived).length}
            </p>
            <p className="text-xs text-muted-foreground">Archived</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search code or name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </form>
        <Select
          value={queryParams.discountType ?? 'all'}
          onValueChange={(v) =>
            setQueryParams((prev) => ({
              ...prev,
              discountType: v === 'all' ? undefined : (v as CouponDiscountType),
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Discount Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {DISCOUNT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {discountTypeLabels[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={
            queryParams.isActive === undefined
              ? 'all'
              : queryParams.isActive
                ? 'active'
                : 'inactive'
          }
          onValueChange={(v) =>
            setQueryParams((prev) => ({
              ...prev,
              isActive: v === 'all' ? undefined : v === 'active',
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Coupons Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Redemptions</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No coupons found. Create your first coupon.
                  </TableCell>
                </TableRow>
              ) : (
                coupons.map((coupon) => (
                  <TableRow key={coupon.id} className={coupon.isArchived ? 'opacity-50' : ''}>
                    <TableCell>
                      <Link
                        href={`/admin/coupons/${coupon.id}`}
                        className="font-mono text-sm font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        {coupon.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{coupon.name}</p>
                      {coupon.description && (
                        <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {coupon.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={discountTypeColors[coupon.discountType] ?? ''}
                        >
                          {discountTypeLabels[coupon.discountType]}
                        </Badge>
                        <span className="font-mono text-sm font-semibold">
                          {formatDiscountValue(coupon.discountType, coupon.discountValue)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {coupon.appliesToBillingPeriod === 'any'
                        ? 'Any'
                        : coupon.appliesToBillingPeriod.charAt(0).toUpperCase() +
                          coupon.appliesToBillingPeriod.slice(1)}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">
                        {coupon.currentRedemptions}
                        {coupon.maxRedemptions
                          ? ` / ${coupon.maxRedemptions}`
                          : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {coupon.expiresAt ? (
                        <span
                          className={
                            isExpired(coupon.expiresAt) ? 'text-destructive' : ''
                          }
                        >
                          {new Date(coupon.expiresAt).toLocaleDateString()}
                          {isExpired(coupon.expiresAt) && ' (expired)'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {coupon.isArchived ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : coupon.isActive ? (
                        <Badge className="bg-green-100 text-green-700">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/coupons/${coupon.id}`}>
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          {!coupon.isArchived && (
                            <>
                              <DropdownMenuItem
                                onClick={() =>
                                  coupon.isActive
                                    ? deactivateCoupon.mutate(coupon.id)
                                    : activateCoupon.mutate(coupon.id)
                                }
                              >
                                {coupon.isActive ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() =>
                                  setArchiveTarget({
                                    id: coupon.id,
                                    code: coupon.code,
                                  })
                                }
                              >
                                Archive
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {response?.hasNext && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() =>
              setQueryParams((prev) => ({
                ...prev,
                cursor: response.nextCursor ?? undefined,
              }))
            }
          >
            Load More
          </Button>
        </div>
      )}

      {/* Create Coupon Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Coupon</DialogTitle>
            <DialogDescription>
              Create a discount coupon for subscriptions.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
            {formErrors.root && (
              <Alert variant="destructive">
                <AlertDescription>{formErrors.root.message}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g. WELCOME20"
                  className="uppercase"
                  {...register('code')}
                />
                {formErrors.code && (
                  <p className="text-xs text-destructive">{formErrors.code.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="Welcome 20% Off"
                  {...register('name')}
                />
                {formErrors.name && (
                  <p className="text-xs text-destructive">{formErrors.name.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Public description..." {...register('description')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Discount Type *</Label>
                <Controller
                  name="discountType"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DISCOUNT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{discountTypeLabels[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="discountValue">
                  Value * {discountType === 'percentage' ? '(%)' : discountType === 'fixed_amount' ? '(centavos)' : discountType === 'trial_extension' ? '(days)' : '(qty)'}
                </Label>
                <Input
                  id="discountValue"
                  type="number"
                  min={1}
                  {...register('discountValue')}
                />
                {formErrors.discountValue && (
                  <p className="text-xs text-destructive">{formErrors.discountValue.message}</p>
                )}
              </div>
            </div>

            {discountType === 'bonus_credit' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Bonus Entitlement Key</Label>
                  <Input placeholder="e.g. ai_answers_per_month" {...register('bonusEntitlementKey')} />
                </div>
                <div className="space-y-2">
                  <Label>Bonus Duration (days)</Label>
                  <Input type="number" min={1} max={3650} {...register('bonusDurationDays')} />
                </div>
              </div>
            )}

            {discountType === 'trial_extension' && (
              <div className="space-y-2">
                <Label>Trial Extension (days)</Label>
                <Input type="number" min={1} max={365} {...register('trialExtensionDays')} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Billing Period</Label>
                <Controller
                  name="appliesToBillingPeriod"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="monthly">Monthly Only</SelectItem>
                        <SelectItem value="annual">Annual Only</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Plan Tier</Label>
                <Controller
                  name="minimumPlanTier"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        {PLAN_TIERS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </SelectItem>
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
                <Input type="number" min={1} placeholder="Unlimited" {...register('maxRedemptions')} />
              </div>
              <div className="space-y-2">
                <Label>Max Per Org</Label>
                <Input type="number" min={1} {...register('maxRedemptionsPerOrg')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Starts At</Label>
                <Input type="datetime-local" {...register('startsAt')} />
              </div>
              <div className="space-y-2">
                <Label>Expires At</Label>
                <Input type="datetime-local" {...register('expiresAt')} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label>Active immediately</Label>
            </div>

            <div className="space-y-2">
              <Label>Internal Notes</Label>
              <Textarea rows={2} placeholder="Admin-only notes..." {...register('internalNotes')} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowCreate(false); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Coupon'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Coupon</AlertDialogTitle>
            <AlertDialogDescription>
              Archive coupon <strong>{archiveTarget?.code}</strong>? It will no
              longer be redeemable. Existing redemptions are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
