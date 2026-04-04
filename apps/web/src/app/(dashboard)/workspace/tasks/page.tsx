'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
} from '@/features/workspace/hooks/use-tasks';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusIcon, SearchIcon, AlertCircleIcon } from 'lucide-react';
import type {
  TaskListItem,
  CreateTaskInput,
  TaskStatus,
  TaskPriority,
} from '@/features/workspace/types';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIORITY_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  urgent: { variant: 'destructive' },
  high: { variant: 'outline', className: 'border-orange-200 bg-orange-50 text-orange-700' },
  medium: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  low: { variant: 'secondary' },
};

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  todo: { variant: 'secondary' },
  in_progress: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  done: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  cancelled: { variant: 'outline', className: 'border-red-200 bg-red-50 text-red-700' },
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isOverdue(task: TaskListItem) {
  if (!task.dueDate || task.status === 'done' || task.status === 'cancelled') return false;
  return new Date(task.dueDate) < new Date();
}

// -- Task Card ----------------------------------------------------------------

function TaskCard({
  task,
  onStatusChange,
  onDelete,
}: {
  task: TaskListItem;
  onStatusChange: (task: TaskListItem, status: TaskStatus) => void;
  onDelete: (task: TaskListItem) => void;
}) {
  const overdue = isOverdue(task);
  const statusStyle = STATUS_BADGE[task.status] ?? STATUS_BADGE['todo'];
  const priorityStyle = PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE['medium'];

  return (
    <Card className="transition hover:shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <Link
              href={ROUTES.WORKSPACE_TASK(task.id)}
              className="text-sm font-medium hover:underline"
            >
              {task.title}
            </Link>
            {task.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
            )}
          </div>
          <Badge variant={priorityStyle.variant} className={priorityStyle.className}>
            {task.priority}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={task.status}
            onValueChange={(v) => onStatusChange(task, v as TaskStatus)}
          >
            <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs">
              <Badge variant={statusStyle.variant} className={`pointer-events-none ${statusStyle.className ?? ''}`}>
                {STATUS_OPTIONS.find((s) => s.value === task.status)?.label ?? task.status}
              </Badge>
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {task.dueDate && (
            <span className={`text-xs ${overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              Due {formatDate(task.dueDate)}
            </span>
          )}

          {task.assignedTo && (
            <span className="text-xs text-muted-foreground">
              {task.assignedTo.fullName}
            </span>
          )}

          {task.matter && (
            <Link href={ROUTES.WORKSPACE_MATTER(task.matter.id)} className="text-xs text-blue-600 hover:underline">
              {task.matter.title}
            </Link>
          )}

          {task._count.comments > 0 && (
            <span className="text-xs text-muted-foreground">
              {task._count.comments} comment{task._count.comments !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(task)}
            className="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -- Create Task Dialog -------------------------------------------------------

function CreateTaskDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  const [matterId, setMatterId] = useState('none');

  const createTask = useCreateTask();
  const { data: mattersData } = useMatters({ limit: 100 });
  const matters = mattersData?.data ?? [];

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;

      const input: CreateTaskInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority: priority as TaskPriority,
        dueDate: dueDate || undefined,
        matterId: matterId !== 'none' ? matterId : undefined,
      };

      createTask.mutate(input, {
        onSuccess: () => {
          setTitle('');
          setDescription('');
          setPriority('medium');
          setDueDate('');
          setMatterId('none');
          onClose();
        },
      });
    },
    [title, description, priority, dueDate, matterId, createTask, onClose],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title *</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due Date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Linked Matter</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {matters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createTask.isPending || !title.trim()}>
              {createTask.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -- Main Page ----------------------------------------------------------------

export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data, isLoading, error } = useTasks({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    priority: priorityFilter !== 'all' ? priorityFilter : undefined,
    search: search || undefined,
  });
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const tasks = data?.data ?? [];

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearch(searchInput);
    },
    [searchInput],
  );

  const handleStatusChange = useCallback(
    (task: TaskListItem, status: TaskStatus) => {
      updateTask.mutate({ id: task.id, status });
    },
    [updateTask],
  );

  const handleDelete = useCallback(
    (task: TaskListItem) => {
      if (window.confirm(`Delete "${task.title}"? This will also remove all comments.`)) {
        deleteTask.mutate(task.id);
      }
    },
    [deleteTask],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track and manage your team&apos;s work
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <PlusIcon className="mr-2 size-4" />
          New Task
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tasks..."
            className="w-64"
          />
          <Button type="submit" variant="outline">
            <SearchIcon className="mr-2 size-4" />
            Search
          </Button>
        </form>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Task List */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>Failed to load tasks. Please try again.</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && tasks.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'No tasks match your filters.'
              : 'No tasks yet. Create your first task to get started.'}
          </p>
        </div>
      )}

      {!isLoading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <CreateTaskDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
