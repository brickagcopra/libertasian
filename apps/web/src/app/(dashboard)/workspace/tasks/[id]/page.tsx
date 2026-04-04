'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useCreateTaskComment,
  useDeleteTaskComment,
} from '@/features/workspace/hooks/use-tasks';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircleIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { TaskStatus, TaskPriority, TaskComment } from '@/features/workspace/types';

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

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// -- Comment Item -------------------------------------------------------------

function CommentItem({
  comment,
  taskId,
}: {
  comment: TaskComment;
  taskId: string;
}) {
  const deleteComment = useDeleteTaskComment();

  return (
    <Card>
      <CardContent className="flex gap-3 p-3">
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-xs">
            {comment.user.fullName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{comment.user.fullName}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{comment.body}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm('Delete this comment?')) {
              deleteComment.mutate({ taskId, commentId: comment.id });
            }
          }}
          className="h-auto shrink-0 px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
        >
          Delete
        </Button>
      </CardContent>
    </Card>
  );
}

// -- Comment Form -------------------------------------------------------------

function CommentForm({ taskId }: { taskId: string }) {
  const [body, setBody] = useState('');
  const createComment = useCreateTaskComment();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!body.trim()) return;

      createComment.mutate(
        { taskId, body: body.trim() },
        {
          onSuccess: () => setBody(''),
        },
      );
    },
    [body, taskId, createComment],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment..."
        rows={3}
        maxLength={5000}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={createComment.isPending || !body.trim()}
        >
          {createComment.isPending ? 'Posting...' : 'Comment'}
        </Button>
      </div>
    </form>
  );
}

// -- Main Page ----------------------------------------------------------------

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { data: task, isLoading, error } = useTask(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { data: mattersData } = useMatters({ limit: 100 });
  const matters = mattersData?.data ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editMatterId, setEditMatterId] = useState('none');

  const startEdit = useCallback(() => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditDueDate(task.dueDate ? task.dueDate.split('T')[0] : '');
    setEditMatterId(task.matter?.id ?? 'none');
    setIsEditing(true);
  }, [task]);

  const handleSave = useCallback(() => {
    if (!task) return;
    updateTask.mutate(
      {
        id: task.id,
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        dueDate: editDueDate || null,
        matterId: editMatterId !== 'none' ? editMatterId : null,
      },
      { onSuccess: () => setIsEditing(false) },
    );
  }, [task, editTitle, editDescription, editDueDate, editMatterId, updateTask]);

  const handleDelete = useCallback(() => {
    if (!task) return;
    if (window.confirm(`Delete "${task.title}"? This will also remove all comments.`)) {
      deleteTask.mutate(task.id, { onSuccess: () => router.push(ROUTES.WORKSPACE_TASKS) });
    }
  }, [task, deleteTask, router]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border bg-muted" />
        <div className="h-48 animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>Task not found or failed to load.</AlertDescription>
      </Alert>
    );
  }

  const statusStyle = STATUS_BADGE[task.status] ?? STATUS_BADGE['todo'];
  const priorityStyle = PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE['medium'];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={ROUTES.WORKSPACE_TASKS} className="hover:text-foreground">Tasks</Link>
        <span>/</span>
        <span className="text-foreground">{task.title}</span>
      </div>

      {/* Task Header */}
      <Card>
        <CardContent className="p-6">
          {isEditing ? (
            <div className="space-y-4">
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-lg font-semibold"
                maxLength={500}
              />
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                placeholder="Description"
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Linked Matter</Label>
                  <Select value={editMatterId} onValueChange={setEditMatterId}>
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
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateTask.isPending || !editTitle.trim()}
                >
                  {updateTask.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <h1 className="text-xl font-bold">{task.title}</h1>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={startEdit}>
                    <PencilIcon className="mr-2 size-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2Icon className="mr-2 size-4" />
                    Delete
                  </Button>
                </div>
              </div>
              {task.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
              )}
            </>
          )}

          {/* Task metadata */}
          {!isEditing && (
            <>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-1">
                    <Select
                      value={task.status}
                      onValueChange={(v) => updateTask.mutate({ id: task.id, status: v as TaskStatus })}
                    >
                      <SelectTrigger className="h-7 w-auto gap-1 px-2">
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
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <div className="mt-1">
                    <Select
                      value={task.priority}
                      onValueChange={(v) => updateTask.mutate({ id: task.id, priority: v as TaskPriority })}
                    >
                      <SelectTrigger className="h-7 w-auto gap-1 px-2">
                        <Badge variant={priorityStyle.variant} className={`pointer-events-none ${priorityStyle.className ?? ''}`}>
                          {PRIORITY_OPTIONS.find((p) => p.value === task.priority)?.label ?? task.priority}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Due Date</span>
                  <p className="mt-1 font-medium">{formatDate(task.dueDate) ?? 'No due date'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Assigned To</span>
                  <p className="mt-1 font-medium">{task.assignedTo?.fullName ?? 'Unassigned'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created By</span>
                  <p className="mt-1 font-medium">{task.createdBy.fullName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Matter</span>
                  <p className="mt-1 font-medium">
                    {task.matter ? (
                      <Link href={ROUTES.WORKSPACE_MATTER(task.matter.id)} className="text-blue-600 hover:underline">
                        {task.matter.title}
                      </Link>
                    ) : (
                      'None'
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p className="mt-1 font-medium">{formatDate(task.createdAt)}</p>
                </div>
                {task.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completed</span>
                    <p className="mt-1 font-medium">{formatDate(task.completedAt)}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Comments Section */}
      <Card>
        <CardHeader>
          <CardTitle>Comments ({task.comments?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {task.comments && task.comments.length > 0 ? (
            <div className="space-y-3">
              {task.comments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} taskId={task.id} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}

          <Separator />
          <CommentForm taskId={task.id} />
        </CardContent>
      </Card>
    </div>
  );
}
