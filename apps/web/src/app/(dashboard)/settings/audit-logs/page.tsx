'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  DownloadIcon,
  FilterIcon,
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  Loader2Icon,
  FileTextIcon,
  ClockIcon,
  UserIcon,
  TagIcon,
} from 'lucide-react';

import {
  useAuditLogs,
  useAuditEntityTypes,
  useAuditActions,
  useExportAuditLogsCsv,
} from '@/features/settings/hooks/use-rbac';
import { PermissionGate } from '@/components/layout/permission-gate';
import type { FullAuditLogItem, ListAllAuditLogsParams } from '@/features/settings/hooks/use-rbac';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const ACTION_COLORS: Record<string, string> = {
  'role.assigned': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'role.removed': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  'role.created': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  'role.updated': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'role.deleted': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  created: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  updated: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  deleted: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  published: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  login: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  logout: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

function getActionColor(action: string): string {
  if (ACTION_COLORS[action]) return ACTION_COLORS[action];
  // Try partial match (e.g., "document.created" matches "created")
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (action.endsWith(key) || action.includes(key)) return cls;
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
}

function formatEntityType(entityType: string): string {
  return entityType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AuditLogsPage() {
  return (
    <PermissionGate
      permissions="audit-logs:read"
      fallback={
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FileTextIcon className="size-12 text-muted-foreground" />
          <p className="text-lg font-medium">Access Denied</p>
          <p className="text-muted-foreground">
            You do not have permission to view audit logs.
          </p>
          <Button variant="outline" asChild>
            <Link href="/settings">Back to Settings</Link>
          </Button>
        </div>
      }
    >
      <AuditLogsContent />
    </PermissionGate>
  );
}

function AuditLogsContent() {
  // Filter state
  const [selectedAction, setSelectedAction] = useState<string>('all');
  const [selectedEntityType, setSelectedEntityType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pagination
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  // Detail dialog
  const [selectedLog, setSelectedLog] = useState<FullAuditLogItem | null>(null);

  // Build query params
  const queryParams = useMemo<ListAllAuditLogsParams>(() => {
    const p: ListAllAuditLogsParams = { limit: PAGE_SIZE };
    if (currentCursor) p.cursor = currentCursor;
    if (selectedAction && selectedAction !== 'all') p.action = [selectedAction];
    if (selectedEntityType && selectedEntityType !== 'all') p.entityType = [selectedEntityType];
    if (dateFrom) p.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) p.dateTo = new Date(dateTo + 'T23:59:59.999Z').toISOString();
    return p;
  }, [currentCursor, selectedAction, selectedEntityType, dateFrom, dateTo]);

  const { data, isLoading, isError } = useAuditLogs(queryParams);
  const { data: entityTypes } = useAuditEntityTypes();
  const { data: actions } = useAuditActions();
  const exportMutation = useExportAuditLogsCsv();

  const handleNextPage = useCallback(() => {
    if (data?.meta?.nextCursor) {
      setCursorStack((prev) => [...prev, data.meta.nextCursor!]);
    }
  }, [data?.meta?.nextCursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => prev.slice(0, -1));
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedAction('all');
    setSelectedEntityType('all');
    setDateFrom('');
    setDateTo('');
    setCursorStack([]);
  }, []);

  const handleExportCsv = useCallback(async () => {
    const exportParams: ListAllAuditLogsParams = {};
    if (selectedAction && selectedAction !== 'all') exportParams.action = [selectedAction];
    if (selectedEntityType && selectedEntityType !== 'all') exportParams.entityType = [selectedEntityType];
    if (dateFrom) exportParams.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) exportParams.dateTo = new Date(dateTo + 'T23:59:59.999Z').toISOString();

    try {
      const csvData = await exportMutation.mutateAsync(exportParams);
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Error handled by mutation state
    }
  }, [exportMutation, selectedAction, selectedEntityType, dateFrom, dateTo]);

  // Reset pagination when filters change
  const handleFilterChange = useCallback(
    (setter: (v: string) => void) => (value: string) => {
      setter(value);
      setCursorStack([]);
    },
    [],
  );

  const hasFilters =
    (selectedAction && selectedAction !== 'all') ||
    (selectedEntityType && selectedEntityType !== 'all') ||
    dateFrom ||
    dateTo;

  const pageNumber = cursorStack.length + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Audit Logs</h1>
            <p className="text-sm text-muted-foreground">
              View all organization activity and changes
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCsv}
          disabled={exportMutation.isPending}
        >
          {exportMutation.isPending ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <DownloadIcon className="mr-2 size-4" />
          )}
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FilterIcon className="size-4" />
            Filters
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="ml-auto h-7 text-xs"
              >
                <XIcon className="mr-1 size-3" />
                Clear
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Action filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <Select
                value={selectedAction}
                onValueChange={handleFilterChange(setSelectedAction)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actions?.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity type filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Entity Type</label>
              <Select
                value={selectedEntityType}
                onValueChange={handleFilterChange(setSelectedEntityType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {entityTypes?.map((et) => (
                    <SelectItem key={et} value={et}>
                      {formatEntityType(et)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
              />
            </div>

            {/* Date to */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center text-destructive">
              Failed to load audit logs. Please try again.
            </div>
          ) : data?.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <FileTextIcon className="size-10" />
              <p className="font-medium">No audit logs found</p>
              {hasFilters && (
                <p className="text-sm">Try adjusting your filters</p>
              )}
            </div>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Date</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead className="w-[140px]">Entity Type</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead className="w-[100px] text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((log) => (
                    <TableRow
                      key={log.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <ClockIcon className="size-3.5 shrink-0" />
                          {formatDate(log.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${getActionColor(log.action)}`}
                        >
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <TagIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-sm">
                            {formatEntityType(log.entityType)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {log.actorName ?? 'System'}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {log.actorType}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLog(log);
                              }}
                            >
                              View
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View full details</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}

          {/* Pagination */}
          {data && data.items.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Page {pageNumber}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={cursorStack.length === 0}
                >
                  <ChevronLeftIcon className="mr-1 size-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!data.meta.hasNext}
                >
                  Next
                  <ChevronRightIcon className="ml-1 size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <AuditLogDetailDialog
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Dialog
// ---------------------------------------------------------------------------

function AuditLogDetailDialog({
  log,
  onClose,
}: {
  log: FullAuditLogItem | null;
  onClose: () => void;
}) {
  if (!log) return null;

  const metadataEntries = Object.entries(log.metadata ?? {});

  return (
    <Dialog open={!!log} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5" />
            Audit Log Detail
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Action</span>
            <Badge
              variant="secondary"
              className={getActionColor(log.action)}
            >
              {log.action}
            </Badge>
          </div>

          {/* Entity */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Entity Type</span>
            <span className="text-sm">{formatEntityType(log.entityType)}</span>
          </div>

          {log.entityId && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Entity ID</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                {log.entityId}
              </code>
            </div>
          )}

          {/* Actor */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Actor</span>
            <div className="text-right">
              <p className="text-sm font-medium">{log.actorName ?? 'System'}</p>
              {log.actorEmail && (
                <p className="text-xs text-muted-foreground">{log.actorEmail}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Actor Type</span>
            <Badge variant="outline" className="text-xs">
              {log.actorType}
            </Badge>
          </div>

          {/* Timestamp */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Timestamp</span>
            <span className="text-sm">{formatDate(log.createdAt)}</span>
          </div>

          {/* Metadata */}
          {metadataEntries.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Metadata</span>
              <div className="rounded-md border bg-muted/50 p-3">
                <pre className="max-h-60 overflow-auto text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Log ID */}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">Log ID</span>
            <code className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
              {log.id}
            </code>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
