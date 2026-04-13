'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Play, Pause, RotateCcw, StopCircle, DollarSign, Trash2 } from 'lucide-react';

import {
  useBackfillBatches,
  useCreateBackfillBatch,
  useStartBackfillBatch,
  usePauseBackfillBatch,
  useResumeBackfillBatch,
  useHaltBackfillBatch,
  useExtendBackfillBudget,
  useDeleteBackfillBatch,
} from '@/features/admin/hooks/use-backfill';
import { useSources } from '@/features/admin/hooks/use-admin';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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

const STATUS_VARIANTS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  enumerating: 'bg-blue-100 text-blue-700',
  running: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  halted_budget: 'bg-orange-100 text-orange-700',
  halted_admin: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-200 text-green-800',
  failed: 'bg-red-100 text-red-700',
};

export default function BackfillPage() {
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSourceId, setFilterSourceId] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [haltDialog, setHaltDialog] = useState<{ open: boolean; batchId: string }>({ open: false, batchId: '' });
  const [haltReason, setHaltReason] = useState('');
  const [budgetDialog, setBudgetDialog] = useState<{ open: boolean; batchId: string }>({ open: false, batchId: '' });
  const [newBudget, setNewBudget] = useState('');
  const [budgetReason, setBudgetReason] = useState('');

  // Form state for create dialog
  const [formSourceId, setFormSourceId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formYearStart, setFormYearStart] = useState('');
  const [formYearEnd, setFormYearEnd] = useState('');
  const [formMonthStart, setFormMonthStart] = useState('');
  const [formMonthEnd, setFormMonthEnd] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formAdminNotes, setFormAdminNotes] = useState('');
  const [formStartImmediately, setFormStartImmediately] = useState(false);

  const { data: batchesData, isLoading } = useBackfillBatches({
    status: filterStatus && filterStatus !== 'all' ? filterStatus : undefined,
    sourceId: filterSourceId && filterSourceId !== 'all' ? filterSourceId : undefined,
  });
  const { data: sourcesData } = useSources();

  const createMutation = useCreateBackfillBatch();
  const startMutation = useStartBackfillBatch();
  const pauseMutation = usePauseBackfillBatch();
  const resumeMutation = useResumeBackfillBatch();
  const haltMutation = useHaltBackfillBatch();
  const extendBudgetMutation = useExtendBackfillBudget();
  const deleteMutation = useDeleteBackfillBatch();

  const batches = batchesData?.items ?? [];
  const sources = sourcesData ?? [];
  const total = batchesData?.meta?.total ?? 0;

  const runningCount = batches.filter((b) => b.status === 'running').length;
  const completedCount = batches.filter((b) => b.status === 'completed').length;
  const failedCount = batches.filter((b) => b.status === 'failed').length;

  const handleCreate = () => {
    createMutation.mutate(
      {
        sourceId: formSourceId,
        name: formName,
        description: formDescription || undefined,
        yearStart: Number(formYearStart),
        yearEnd: Number(formYearEnd),
        monthStart: formMonthStart ? Number(formMonthStart) : undefined,
        monthEnd: formMonthEnd ? Number(formMonthEnd) : undefined,
        budgetCeilingUsd: Number(formBudget),
        adminNotes: formAdminNotes || undefined,
        startImmediately: formStartImmediately,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          resetCreateForm();
        },
      },
    );
  };

  const resetCreateForm = () => {
    setFormSourceId('');
    setFormName('');
    setFormDescription('');
    setFormYearStart('');
    setFormYearEnd('');
    setFormMonthStart('');
    setFormMonthEnd('');
    setFormBudget('');
    setFormAdminNotes('');
    setFormStartImmediately(false);
  };

  const handleHalt = () => {
    haltMutation.mutate(
      { id: haltDialog.batchId, reason: haltReason },
      {
        onSuccess: () => {
          setHaltDialog({ open: false, batchId: '' });
          setHaltReason('');
        },
      },
    );
  };

  const handleExtendBudget = () => {
    extendBudgetMutation.mutate(
      {
        id: budgetDialog.batchId,
        newCeilingUsd: Number(newBudget),
        reason: budgetReason,
      },
      {
        onSuccess: () => {
          setBudgetDialog({ open: false, batchId: '' });
          setNewBudget('');
          setBudgetReason('');
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="text-2xl font-bold">Backfill Management</h1>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 size-4" />
              New Batch
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Backfill Batch</DialogTitle>
              <DialogDescription>
                Start a historical ingestion batch for a source.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Source</Label>
                <Select value={formSourceId} onValueChange={setFormSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. SC Backfill 2020-2023" />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Year Start</Label>
                  <Input type="number" value={formYearStart} onChange={(e) => setFormYearStart(e.target.value)} min={1901} max={2100} />
                </div>
                <div>
                  <Label>Year End</Label>
                  <Input type="number" value={formYearEnd} onChange={(e) => setFormYearEnd(e.target.value)} min={1901} max={2100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Month Start (optional)</Label>
                  <Input type="number" value={formMonthStart} onChange={(e) => setFormMonthStart(e.target.value)} min={1} max={12} />
                </div>
                <div>
                  <Label>Month End (optional)</Label>
                  <Input type="number" value={formMonthEnd} onChange={(e) => setFormMonthEnd(e.target.value)} min={1} max={12} />
                </div>
              </div>
              <div>
                <Label>Budget Ceiling (USD)</Label>
                <Input type="number" value={formBudget} onChange={(e) => setFormBudget(e.target.value)} min={0.01} step={0.01} />
              </div>
              <div>
                <Label>Admin Notes (optional)</Label>
                <Input value={formAdminNotes} onChange={(e) => setFormAdminNotes(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="startImmediately"
                  checked={formStartImmediately}
                  onChange={(e) => setFormStartImmediately(e.target.checked)}
                  className="size-4"
                />
                <Label htmlFor="startImmediately">Start Immediately</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!formSourceId || !formName || !formYearStart || !formYearEnd || !formBudget || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Batch'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Batches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Running</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{runningCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{completedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{failedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="enumerating">Enumerating</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="halted_budget">Halted (Budget)</SelectItem>
            <SelectItem value="halted_admin">Halted (Admin)</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSourceId} onValueChange={setFilterSourceId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Batch Table */}
      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No backfill batches yet. Create one to start historical ingestion.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Year Range</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Last Tick</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.name}</TableCell>
                  <TableCell>{batch.source?.name ?? 'Unknown'}</TableCell>
                  <TableCell>
                    {batch.yearStart}–{batch.yearEnd}
                    {batch.monthStart && batch.monthEnd && (
                      <span className="text-muted-foreground"> (M{batch.monthStart}–{batch.monthEnd})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_VARIANTS[batch.status] ?? ''}>
                      {batch.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {batch.candidatesProcessed}/{batch.candidatesDiscovered}
                  </TableCell>
                  <TableCell>
                    ${Number(batch.budgetConsumedUsd).toFixed(2)} / ${Number(batch.budgetCeilingUsd).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {batch.lastTickAt ? new Date(batch.lastTickAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {batch.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startMutation.mutate(batch.id)}
                          disabled={startMutation.isPending}
                          title="Start"
                        >
                          <Play className="size-4" />
                        </Button>
                      )}
                      {batch.status === 'running' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => pauseMutation.mutate(batch.id)}
                            disabled={pauseMutation.isPending}
                            title="Pause"
                          >
                            <Pause className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHaltDialog({ open: true, batchId: batch.id })}
                            title="Halt"
                          >
                            <StopCircle className="size-4" />
                          </Button>
                        </>
                      )}
                      {(batch.status === 'paused' || batch.status === 'halted_admin' || batch.status === 'halted_budget') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resumeMutation.mutate(batch.id)}
                          disabled={resumeMutation.isPending}
                          title="Resume"
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                      {batch.status === 'halted_budget' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setBudgetDialog({ open: true, batchId: batch.id })}
                          title="Extend Budget"
                        >
                          <DollarSign className="size-4" />
                        </Button>
                      )}
                      {(batch.status === 'completed' || batch.status === 'failed') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(batch.id)}
                          disabled={deleteMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Halt Dialog */}
      <Dialog open={haltDialog.open} onOpenChange={(open) => setHaltDialog({ open, batchId: open ? haltDialog.batchId : '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Halt Batch</DialogTitle>
            <DialogDescription>Provide a reason for halting this batch.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Reason</Label>
            <Input value={haltReason} onChange={(e) => setHaltReason(e.target.value)} placeholder="Why is this batch being halted?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHaltDialog({ open: false, batchId: '' })}>Cancel</Button>
            <Button onClick={handleHalt} disabled={!haltReason || haltMutation.isPending}>
              {haltMutation.isPending ? 'Halting...' : 'Halt Batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Budget Dialog */}
      <Dialog open={budgetDialog.open} onOpenChange={(open) => setBudgetDialog({ open, batchId: open ? budgetDialog.batchId : '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Budget</DialogTitle>
            <DialogDescription>Set a new budget ceiling for this halted batch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Ceiling (USD)</Label>
              <Input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} min={0.01} step={0.01} />
            </div>
            <div>
              <Label>Reason</Label>
              <Input value={budgetReason} onChange={(e) => setBudgetReason(e.target.value)} placeholder="Reason for budget extension" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetDialog({ open: false, batchId: '' })}>Cancel</Button>
            <Button onClick={handleExtendBudget} disabled={!newBudget || !budgetReason || extendBudgetMutation.isPending}>
              {extendBudgetMutation.isPending ? 'Updating...' : 'Extend Budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
