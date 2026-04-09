'use client';

import { useState } from 'react';
import { MoreHorizontal, RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { AdminListSkeleton } from '@/components/ui/skeleton';

import {
  useAdminLifecycleEvents,
  useLifecycleEventStats,
  useRetryLifecycleEvent,
  useCancelLifecycleEvent,
  useBulkRetryLifecycleEvents,
} from '@/features/billing/hooks/use-admin-lifecycle-events';
import type { ListLifecycleEventsQuery } from '@/features/billing/types';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-sky-100 text-sky-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

const eventTypeLabels: Record<string, string> = {
  cancellation_end: 'Cancellation End',
  renewal: 'Renewal',
  trial_expiry: 'Trial Expiry',
  grace_period_end: 'Grace Period End',
};

export default function LifecycleEventsPage() {
  const [filters, setFilters] = useState<ListLifecycleEventsQuery>({});
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: eventsData, isLoading } = useAdminLifecycleEvents(filters);
  const { data: statsData } = useLifecycleEventStats();

  const retryMutation = useRetryLifecycleEvent();
  const cancelMutation = useCancelLifecycleEvent();
  const bulkRetryMutation = useBulkRetryLifecycleEvents();

  const events = eventsData?.data ?? [];
  const hasNext = eventsData?.hasNext ?? false;
  const nextCursor = eventsData?.nextCursor ?? null;
  const stats = statsData?.data;

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleRetry = async (id: string) => {
    await retryMutation.mutateAsync(id);
    showSuccess('Event queued for retry');
  };

  const handleCancel = async (id: string) => {
    await cancelMutation.mutateAsync(id);
    showSuccess('Event cancelled');
  };

  const handleBulkRetry = async () => {
    const result = await bulkRetryMutation.mutateAsync(filters.eventType);
    const data = result as unknown as { success: boolean; data: { count: number } };
    showSuccess(`${data.data.count} event(s) queued for retry`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({
      ...prev,
      subscriptionId: subscriptionSearch || undefined,
      cursor: undefined,
    }));
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lifecycle Events</h1>
          <p className="text-muted-foreground text-sm">
            Scheduled subscription transitions: renewals, cancellations, trial expirations, grace periods
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleBulkRetry}
          disabled={bulkRetryMutation.isPending || (stats?.statusCounts?.['failed'] ?? 0) === 0}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Bulk Retry Failed
        </Button>
      </div>

      {/* Success Message */}
      {successMsg && (
        <Alert>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground text-sm font-medium">Pending (Due)</div>
            <div className="text-2xl font-bold">{stats?.pendingDueCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground text-sm font-medium">Processing</div>
            <div className="text-2xl font-bold">{stats?.statusCounts?.['processing'] ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground text-sm font-medium">Failed</div>
            <div className="text-2xl font-bold text-red-600">
              {stats?.statusCounts?.['failed'] ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground text-sm font-medium">Completed</div>
            <div className="text-2xl font-bold text-green-600">
              {stats?.statusCounts?.['completed'] ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={handleSearchSubmit} className="flex items-end gap-2">
          <Input
            placeholder="Subscription ID..."
            value={subscriptionSearch}
            onChange={(e) => setSubscriptionSearch(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="outline" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </form>

        <Select
          value={filters.status ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              status: v === 'all' ? undefined : v,
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.eventType ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              eventType: v === 'all' ? undefined : v,
              cursor: undefined,
            }))
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="cancellation_end">Cancellation End</SelectItem>
            <SelectItem value="renewal">Renewal</SelectItem>
            <SelectItem value="trial_expiry">Trial Expiry</SelectItem>
            <SelectItem value="grace_period_end">Grace Period End</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <AdminListSkeleton count={8} />
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No lifecycle events found.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Scheduled At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge variant="secondary">
                        {eventTypeLabels[event.eventType] ?? event.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {event.subscription?.organization?.name ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-muted-foreground max-w-[120px] truncate text-xs font-mono">
                        {event.subscriptionId}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {event.subscription?.planCode} · {event.subscription?.status}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(event.scheduledAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={statusColors[event.status] ?? ''}
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.attempts}/{event.maxAttempts}
                    </TableCell>
                    <TableCell>
                      {event.lastError ? (
                        <span
                          className="max-w-[200px] truncate text-xs text-red-600 block"
                          title={event.lastError}
                        >
                          {event.lastError}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {['failed', 'cancelled'].includes(event.status) && (
                            <DropdownMenuItem
                              onClick={() => handleRetry(event.id)}
                              disabled={retryMutation.isPending}
                            >
                              Retry
                            </DropdownMenuItem>
                          )}
                          {event.status === 'pending' && (
                            <DropdownMenuItem
                              onClick={() => handleCancel(event.id)}
                              disabled={cancelMutation.isPending}
                              className="text-red-600"
                            >
                              Cancel
                            </DropdownMenuItem>
                          )}
                          {!['failed', 'cancelled', 'pending'].includes(event.status) && (
                            <DropdownMenuItem disabled>
                              No actions available
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {hasNext && nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() =>
              setFilters((prev) => ({ ...prev, cursor: nextCursor }))
            }
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
