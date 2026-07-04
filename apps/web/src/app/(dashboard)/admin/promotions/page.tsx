'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Search,
  MoreHorizontal,
  Archive,
  Play,
  Pause,
  MegaphoneIcon,
  CalendarIcon,
} from 'lucide-react';

import {
  useAdminPromotions,
  useCreatePromotion,
  useArchivePromotion,
  useActivatePromotion,
  usePausePromotion,
} from '@/features/billing/hooks/use-admin-promotions';
import type {
  PromotionTypeValue,
  PromotionStatusValue,
  ListPromotionsQuery,
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

const promotionTypeLabels: Record<PromotionTypeValue, string> = {
  sale: 'Sale',
  bonus: 'Bonus',
  trial_extension: 'Trial Extension',
  combined: 'Combined',
};

const promotionTypeBadgeVariants: Record<PromotionTypeValue, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  sale: 'default',
  bonus: 'secondary',
  trial_extension: 'outline',
  combined: 'destructive',
};

const statusLabels: Record<PromotionStatusValue, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  archived: 'Archived',
};

const statusColors: Record<PromotionStatusValue, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700',
  archived: 'bg-gray-200 text-gray-500',
};

// ─── Zod Schema ──────────────────────────────────────────

const createPromotionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  promotionType: z.enum(['sale', 'bonus', 'trial_extension', 'combined']),
  description: z.string().max(1000).optional(),
  priority: z.coerce.number().min(0).max(9999).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

type CreatePromotionFormData = z.infer<typeof createPromotionSchema>;

// ─── Page Component ──────────────────────────────────────

export default function PromotionsAdminPage() {
  const [filters, setFilters] = useState<ListPromotionsQuery>({});
  const [searchInput, setSearchInput] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useAdminPromotions(filters);
  const createMut = useCreatePromotion();
  const archiveMut = useArchivePromotion();
  const activateMut = useActivatePromotion();
  const pauseMut = usePausePromotion();

  const promotions = data?.data ?? [];

  const stats = {
    active: promotions.filter((p) => p.status === 'active').length,
    scheduled: promotions.filter((p) => p.status === 'scheduled').length,
    totalRedemptions: promotions.reduce((s, p) => s + p.currentRedemptions, 0),
    archived: promotions.filter((p) => p.status === 'archived').length,
  };

  const form = useForm<CreatePromotionFormData>({
    resolver: zodResolver(createPromotionSchema),
    defaultValues: {
      name: '',
      slug: '',
      promotionType: 'sale',
      description: '',
      priority: 0,
    },
  });

  const handleSearch = () => {
    setFilters((f) => ({ ...f, search: searchInput || undefined, cursor: undefined }));
  };

  const onCreateSubmit = async (values: CreatePromotionFormData) => {
    setError(null);
    try {
      await createMut.mutateAsync({
        ...values,
        startsAt: values.startsAt || undefined,
        endsAt: values.endsAt || undefined,
      });
      setCreateOpen(false);
      form.reset();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Failed to create promotion',
      );
    }
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    try {
      await archiveMut.mutateAsync(archiveId);
      setArchiveId(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Failed to archive promotion',
      );
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await activateMut.mutateAsync(id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Failed to activate promotion',
      );
    }
  };

  const handlePause = async (id: string) => {
    try {
      await pauseMut.mutateAsync(id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Failed to pause promotion',
      );
    }
  };

  if (isLoading) return <AdminListSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promotions</h1>
          <p className="text-sm text-muted-foreground">
            Manage sales promotions, bonuses, and trial extensions
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" /> New Promotion
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active</p>
            <p className="text-2xl font-bold">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Scheduled</p>
            <p className="text-2xl font-bold">{stats.scheduled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Redemptions</p>
            <p className="text-2xl font-bold">{stats.totalRedemptions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Archived</p>
            <p className="text-2xl font-bold">{stats.archived}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by name or slug..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-64"
          />
          <Button variant="outline" size="icon" onClick={handleSearch}>
            <Search className="size-4" />
          </Button>
        </div>

        <Select
          value={filters.status ?? '_all'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              status: v === '_all' ? undefined : (v as PromotionStatusValue),
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.promotionType ?? '_all'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              promotionType: v === '_all' ? undefined : (v as PromotionTypeValue),
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Types</SelectItem>
            <SelectItem value="sale">Sale</SelectItem>
            <SelectItem value="bonus">Bonus</SelectItem>
            <SelectItem value="trial_extension">Trial Extension</SelectItem>
            <SelectItem value="combined">Combined</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.sortBy ?? 'createdAt'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              sortBy: v as ListPromotionsQuery['sortBy'],
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">Created</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="currentRedemptions">Redemptions</SelectItem>
            <SelectItem value="startsAt">Start Date</SelectItem>
            <SelectItem value="endsAt">End Date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">P</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Redemptions</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {promotions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No promotions found
                </TableCell>
              </TableRow>
            ) : (
              promotions.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell className="font-mono text-xs">{promo.priority}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/promotions/${promo.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {promo.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{promo.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={promotionTypeBadgeVariants[promo.promotionType]}>
                      {promotionTypeLabels[promo.promotionType] ?? promo.promotionType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[promo.status] ?? ''}`}
                    >
                      {statusLabels[promo.status] ?? promo.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {promo.currentRedemptions}
                    {promo.maxRedemptions != null && (
                      <span className="text-muted-foreground">
                        {' '}
                        / {promo.maxRedemptions}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {promo.startsAt && (
                      <div className="flex items-center gap-1">
                        <CalendarIcon className="size-3" />
                        {new Date(promo.startsAt).toLocaleDateString()}
                      </div>
                    )}
                    {promo.endsAt && (
                      <div className="text-muted-foreground">
                        to {new Date(promo.endsAt).toLocaleDateString()}
                      </div>
                    )}
                    {!promo.startsAt && !promo.endsAt && (
                      <span className="text-muted-foreground">No dates</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {promo.isDisplayedOnPricing ? (
                      <Badge variant="outline">Visible</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Hidden</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/promotions/${promo.id}`}>View Details</Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {(promo.status === 'draft' || promo.status === 'scheduled' || promo.status === 'paused') && (
                          <DropdownMenuItem onClick={() => handleActivate(promo.id)}>
                            <Play className="mr-2 size-4" /> Activate
                          </DropdownMenuItem>
                        )}
                        {promo.status === 'active' && (
                          <DropdownMenuItem onClick={() => handlePause(promo.id)}>
                            <Pause className="mr-2 size-4" /> Pause
                          </DropdownMenuItem>
                        )}
                        {promo.status !== 'archived' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setArchiveId(promo.id)}
                            >
                              <Archive className="mr-2 size-4" /> Archive
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
      </Card>

      {/* Pagination */}
      {data?.hasNext && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() =>
              setFilters((f) => ({ ...f, cursor: data.nextCursor ?? undefined }))
            }
          >
            Load More
          </Button>
        </div>
      )}

      {/* Create Promotion Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Promotion</DialogTitle>
            <DialogDescription>
              Create a new promotion. You can configure rules and benefits after creation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promo-name">Name *</Label>
                <Input
                  id="promo-name"
                  {...form.register('name')}
                  placeholder="Summer Sale 2026"
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="promo-slug">Slug *</Label>
                <Input
                  id="promo-slug"
                  {...form.register('slug')}
                  placeholder="summer-sale-2026"
                />
                {form.formState.errors.slug && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.slug.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type *</Label>
                <select
                  {...form.register('promotionType')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="sale">Sale</option>
                  <option value="bonus">Bonus</option>
                  <option value="trial_extension">Trial Extension</option>
                  <option value="combined">Combined</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="promo-priority">Priority</Label>
                <Input
                  id="promo-priority"
                  type="number"
                  {...form.register('priority')}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="promo-desc">Description</Label>
              <Textarea
                id="promo-desc"
                {...form.register('description')}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promo-starts">Starts At</Label>
                <Input
                  id="promo-starts"
                  type="datetime-local"
                  {...form.register('startsAt')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promo-ends">Ends At</Label>
                <Input
                  id="promo-ends"
                  type="datetime-local"
                  {...form.register('endsAt')}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation */}
      <AlertDialog open={!!archiveId} onOpenChange={(o) => !o && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Promotion</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the promotion. It can no longer be redeemed. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {archiveMut.isPending ? 'Archiving...' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
