'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Search,
  MoreHorizontal,
} from 'lucide-react';

import {
  useAdminSubscriptions,
  useGrantComplimentary,
} from '@/features/billing/hooks/use-admin-subscriptions';
import type {
  ListSubscriptionsQuery,
  SubscriptionStatusValue,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Constants ───────────────────────────────────────────

const SUBSCRIPTION_STATUSES: SubscriptionStatusValue[] = [
  'provisioning',
  'trialing',
  'trial_expired',
  'active',
  'past_due',
  'grace_period',
  'suspended',
  'cancelling',
  'cancelled',
  'expired',
  'complimentary',
  'migrating',
  'terminated',
];

const PLAN_CODES = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;

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

// ─── Grant Complimentary Schema ─────────────────────────

const grantComplimentarySchema = z.object({
  organizationId: z.string().uuid('Must be a valid UUID'),
  planCode: z.enum(['edu', 'pro', 'team', 'enterprise'], {
    required_error: 'Plan is required',
  }),
  reason: z.string().min(1, 'Reason is required').max(500),
  endsAt: z.string().optional(),
});

type GrantComplimentaryForm = z.infer<typeof grantComplimentarySchema>;

// ─── Page ────────────────────────────────────────────────

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [queryParams, setQueryParams] = useState<ListSubscriptionsQuery>({});
  const { data: response, isLoading, error } = useAdminSubscriptions(queryParams);
  const grantComplimentary = useGrantComplimentary();

  const [showGrant, setShowGrant] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const subscriptions = response?.data ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors, isSubmitting },
    reset,
    setError,
    control,
  } = useForm<GrantComplimentaryForm>({
    resolver: zodResolver(grantComplimentarySchema),
    defaultValues: {
      planCode: 'pro',
    },
  });

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const onSearch = () => {
    setQueryParams((prev) => ({
      ...prev,
      search: searchInput || undefined,
      cursor: undefined,
    }));
  };

  const onGrantSubmit = async (data: GrantComplimentaryForm) => {
    try {
      const payload = {
        ...data,
        endsAt: data.endsAt || undefined,
      };
      await grantComplimentary.mutateAsync(payload);
      setShowGrant(false);
      reset();
      flash('Complimentary access granted successfully.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      }
    }
  };

  if (isLoading) return <AdminListSkeleton />;

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Subscription Management</h1>
        <Alert variant="destructive">
          <AlertDescription>Failed to load subscriptions. Please try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Subscription Management</h1>
          <p className="text-sm text-muted-foreground">
            {subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''}
            {response?.hasNext ? '+' : ''}
          </p>
        </div>
        <Button onClick={() => setShowGrant(true)}>
          <Plus className="mr-2 size-4" />
          Grant Complimentary
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
              {subscriptions.filter((s) => s.status === 'active').length}
            </p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {subscriptions.filter((s) => s.status === 'trialing').length}
            </p>
            <p className="text-xs text-muted-foreground">Trialing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {subscriptions.filter((s) => s.status === 'complimentary').length}
            </p>
            <p className="text-xs text-muted-foreground">Complimentary</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {subscriptions.filter((s) =>
                ['past_due', 'suspended', 'terminated'].includes(s.status),
              ).length}
            </p>
            <p className="text-xs text-muted-foreground">Issues</p>
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
            placeholder="Search organization..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </form>
        <Select
          value={queryParams.status ?? 'all'}
          onValueChange={(v) =>
            setQueryParams((prev) => ({
              ...prev,
              status: v === 'all' ? undefined : (v as SubscriptionStatusValue),
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={queryParams.planCode ?? 'all'}
          onValueChange={(v) =>
            setQueryParams((prev) => ({
              ...prev,
              planCode: v === 'all' ? undefined : v,
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            {PLAN_CODES.map((p) => (
              <SelectItem key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Subscriptions Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing Period</TableHead>
                <TableHead>Current Period</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No subscriptions found.
                  </TableCell>
                </TableRow>
              ) : (
                subscriptions.map((sub) => (
                  <TableRow
                    key={sub.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/admin/subscriptions/${sub.id}`)}
                  >
                    <TableCell>
                      <p className="font-medium">{sub.organization.name}</p>
                      <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {sub.organization.slug}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {sub.plan?.name ?? sub.planCode}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={statusColors[sub.status] ?? ''}
                      >
                        {statusLabels[sub.status] ?? sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sub.billingPeriod === 'monthly'
                        ? 'Monthly'
                        : sub.billingPeriod === 'annual'
                          ? 'Annual'
                          : sub.billingPeriod}
                    </TableCell>
                    <TableCell className="text-sm">
                      {sub.currentPeriodStart && sub.currentPeriodEnd ? (
                        <span>
                          {new Date(sub.currentPeriodStart).toLocaleDateString()} —{' '}
                          {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/subscriptions/${sub.id}`}>
                              View Details
                            </Link>
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

      {/* Grant Complimentary Dialog */}
      <Dialog open={showGrant} onOpenChange={setShowGrant}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grant Complimentary Access</DialogTitle>
            <DialogDescription>
              Grant free access to a plan for an organization.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onGrantSubmit)} className="space-y-4">
            {formErrors.root && (
              <Alert variant="destructive">
                <AlertDescription>{formErrors.root.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="organizationId">Organization ID *</Label>
              <Input
                id="organizationId"
                placeholder="UUID of the organization"
                {...register('organizationId')}
              />
              {formErrors.organizationId && (
                <p className="text-xs text-destructive">
                  {formErrors.organizationId.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Plan *</Label>
              <Controller
                name="planCode"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edu">Edu</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="team">Team</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {formErrors.planCode && (
                <p className="text-xs text-destructive">
                  {formErrors.planCode.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Textarea
                id="reason"
                rows={3}
                placeholder="Why is complimentary access being granted?"
                {...register('reason')}
              />
              {formErrors.reason && (
                <p className="text-xs text-destructive">
                  {formErrors.reason.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="endsAt">Ends At (optional)</Label>
              <Input
                id="endsAt"
                type="datetime-local"
                {...register('endsAt')}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for indefinite access.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowGrant(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Granting...' : 'Grant Access'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
