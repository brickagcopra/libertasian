'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Archive,
  Eye,
  EyeOff,
  CreditCard,
  Search,
  ArrowUpDown,
  MoreHorizontal,
  Check,
  X,
} from 'lucide-react';

import {
  useAdminPlans,
  useCreatePlan,
  useArchivePlan,
  useUpdatePlan,
} from '@/features/billing/hooks/use-admin-plans';
import { formatPHP } from '@/features/billing/types';
import type {
  AdminPlanDetail,
  PlanType,
  PlanCategory,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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

const PLAN_TYPES: PlanType[] = ['standard', 'trial', 'complimentary', 'custom'];
const PLAN_CATEGORIES: PlanCategory[] = ['individual', 'team', 'academic', 'enterprise'];

const typeColors: Record<string, string> = {
  standard: 'bg-blue-100 text-blue-700',
  trial: 'bg-amber-100 text-amber-700',
  complimentary: 'bg-green-100 text-green-700',
  custom: 'bg-purple-100 text-purple-700',
};

const categoryColors: Record<string, string> = {
  individual: 'bg-slate-100 text-slate-700',
  team: 'bg-indigo-100 text-indigo-700',
  academic: 'bg-emerald-100 text-emerald-700',
  enterprise: 'bg-rose-100 text-rose-700',
};

// ─── Create Plan Schema ──────────────────────────────────

const createPlanSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores only'),
  name: z.string().min(1, 'Name is required').max(255),
  displayName: z.string().max(255).optional(),
  description: z.string().optional(),
  type: z.enum(['standard', 'trial', 'complimentary', 'custom']),
  category: z.enum(['individual', 'team', 'academic', 'enterprise']).optional(),
  isActive: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  displayOrder: z.coerce.number().min(0).max(9999).optional(),
  trialEnabled: z.boolean().optional(),
  trialDurationDays: z.coerce.number().min(1).max(365).optional(),
  maxSeats: z.coerce.number().min(1).optional().or(z.literal('')),
  internalNotes: z.string().optional(),
  isFeatured: z.boolean().optional(),
  featuredLabel: z.string().max(50).optional().or(z.literal('')),
  ctaText: z.string().max(50).optional().or(z.literal('')),
  highlightColor: z.string().max(20).optional().or(z.literal('')),
});

type CreatePlanForm = z.infer<typeof createPlanSchema>;

// ─── Helper ──────────────────────────────────────────────

function getMonthlyPrice(plan: AdminPlanDetail): number {
  const price = plan.prices.find(
    (p) => p.billingInterval === 'monthly' && p.isActive,
  );
  return price?.amount ?? 0;
}

function getAnnualPrice(plan: AdminPlanDetail): number {
  const price = plan.prices.find(
    (p) => p.billingInterval === 'annual' && p.isActive,
  );
  return price?.amount ?? 0;
}

// ─── Page ────────────────────────────────────────────────

export default function AdminPlansPage() {
  const { data: plans, isLoading, error } = useAdminPlans();
  const createPlan = useCreatePlan();
  const archivePlan = useArchivePlan();
  const updatePlan = useUpdatePlan();

  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AdminPlanDetail | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [sortField, setSortField] = useState<'displayOrder' | 'name' | 'code'>('displayOrder');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors, isSubmitting },
    reset,
    setError,
    control,
    watch,
  } = useForm<CreatePlanForm>({
    resolver: zodResolver(createPlanSchema),
    defaultValues: {
      type: 'standard',
      isActive: true,
      isVisible: true,
      displayOrder: 0,
      trialEnabled: false,
    },
  });

  const trialEnabled = watch('trialEnabled');

  // Filter & sort
  const filteredPlans = useMemo(() => {
    if (!plans) return [];
    let result = [...plans];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q),
      );
    }

    if (filterType !== 'all') {
      result = result.filter((p) => p.type === filterType);
    }

    if (filterActive === 'active') {
      result = result.filter((p) => p.isActive);
    } else if (filterActive === 'inactive') {
      result = result.filter((p) => !p.isActive);
    }

    result.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return result;
  }, [plans, searchQuery, filterType, filterActive, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const onCreateSubmit = async (data: CreatePlanForm) => {
    try {
      const payload = {
        ...data,
        maxSeats: data.maxSeats === '' ? undefined : data.maxSeats ? Number(data.maxSeats) : undefined,
      };
      await createPlan.mutateAsync(payload);
      setShowCreate(false);
      reset();
      setSuccessMsg('Plan created successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      }
    }
  };

  const onArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archivePlan.mutateAsync(archiveTarget.id);
      setArchiveTarget(null);
      setSuccessMsg(`Plan "${archiveTarget.code}" archived.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch {
      // handled by mutation error state
    }
  };

  const onToggleVisibility = async (plan: AdminPlanDetail) => {
    await updatePlan.mutateAsync({
      id: plan.id,
      data: { isVisible: !plan.isVisible },
    });
  };

  const onToggleActive = async (plan: AdminPlanDetail) => {
    await updatePlan.mutateAsync({
      id: plan.id,
      data: { isActive: !plan.isActive },
    });
  };

  // ─── Render ────────────────────────────────────────────

  if (isLoading) return <AdminListSkeleton />;

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Plan Management</h1>
        <Alert variant="destructive">
          <AlertDescription>Failed to load plans. Please try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Plan Management</h1>
          <p className="text-sm text-muted-foreground">
            {plans?.length ?? 0} plan{plans?.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 size-4" />
          Create Plan
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
              {plans?.filter((p) => p.isActive).length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Active Plans</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {plans?.filter((p) => p.isVisible).length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Publicly Visible</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {plans?.filter((p) => p.trialEnabled).length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Trial-Enabled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {plans?.reduce((sum, p) => sum + p.entitlements.length, 0) ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Total Entitlements</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {PLAN_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterActive} onValueChange={setFilterActive}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Plans Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort('displayOrder')}
                >
                  <span className="flex items-center gap-1">
                    # <ArrowUpDown className="size-3" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort('code')}
                >
                  <span className="flex items-center gap-1">
                    Code <ArrowUpDown className="size-3" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort('name')}
                >
                  <span className="flex items-center gap-1">
                    Name <ArrowUpDown className="size-3" />
                  </span>
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Monthly</TableHead>
                <TableHead>Annual</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-center">Visible</TableHead>
                <TableHead className="text-center">Trial</TableHead>
                <TableHead>Entitlements</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPlans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                    {searchQuery || filterType !== 'all' || filterActive !== 'all'
                      ? 'No plans match the current filters.'
                      : 'No plans found. Create your first plan.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredPlans.map((plan) => (
                  <TableRow key={plan.id} className="group">
                    <TableCell className="text-muted-foreground">
                      {plan.displayOrder}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/plans/${plan.id}`}
                        className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {plan.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{plan.displayName || plan.name}</p>
                        {plan.description && (
                          <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {plan.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={typeColors[plan.type] ?? ''}
                      >
                        {plan.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={categoryColors[plan.category] ?? ''}
                      >
                        {plan.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatPHP(getMonthlyPrice(plan))}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatPHP(getAnnualPrice(plan))}
                    </TableCell>
                    <TableCell className="text-center">
                      {plan.isActive ? (
                        <Check className="mx-auto size-4 text-green-600" />
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {plan.isVisible ? (
                        <Eye className="mx-auto size-4 text-green-600" />
                      ) : (
                        <EyeOff className="mx-auto size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {plan.trialEnabled ? (
                        <span className="text-xs font-medium text-amber-600">
                          {plan.trialDurationDays}d
                        </span>
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{plan.entitlements.length}</Badge>
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
                            <Link href={`/admin/plans/${plan.id}`}>View Details</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onToggleActive(plan)}
                          >
                            {plan.isActive ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onToggleVisibility(plan)}
                          >
                            {plan.isVisible ? 'Hide from Public' : 'Show Publicly'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setArchiveTarget(plan)}
                          >
                            Archive Plan
                          </DropdownMenuItem>
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

      {/* Create Plan Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Plan</DialogTitle>
            <DialogDescription>
              Add a new subscription plan with pricing and entitlements.
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
                  placeholder="e.g. pro_plus"
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
                  placeholder="e.g. Pro Plus Plan"
                  {...register('name')}
                />
                {formErrors.name && (
                  <p className="text-xs text-destructive">{formErrors.name.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="Shown on pricing page"
                {...register('displayName')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief plan description..."
                rows={2}
                {...register('description')}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Controller
                  name="type"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v || undefined)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="displayOrder">Display Order</Label>
                <Input
                  id="displayOrder"
                  type="number"
                  min={0}
                  max={9999}
                  {...register('displayOrder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxSeats">Max Seats</Label>
                <Input
                  id="maxSeats"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  {...register('maxSeats')}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-6">
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <Label>Active</Label>
                  </div>
                )}
              />
              <Controller
                name="isVisible"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <Label>Publicly Visible</Label>
                  </div>
                )}
              />
              <Controller
                name="trialEnabled"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <Label>Trial Enabled</Label>
                  </div>
                )}
              />
            </div>

            {trialEnabled && (
              <div className="space-y-2">
                <Label htmlFor="trialDurationDays">Trial Duration (days)</Label>
                <Input
                  id="trialDurationDays"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="14"
                  {...register('trialDurationDays')}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="internalNotes">Internal Notes</Label>
              <Textarea
                id="internalNotes"
                placeholder="Admin-only notes..."
                rows={2}
                {...register('internalNotes')}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreate(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Plan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive the plan{' '}
              <strong>{archiveTarget?.code}</strong>? This will deactivate the
              plan and hide it from the public pricing page. Existing subscribers
              will not be affected.
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
