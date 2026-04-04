import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  TaskFilters,
  TaskListResponse,
  TaskDetailResponse,
  TaskListItem,
  TaskComment,
  CreateTaskInput,
  UpdateTaskInput,
} from '../types';

export function useTasks(filters: TaskFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.priority) params['priority'] = filters.priority;
  if (filters.assignedToUserId)
    params['assignedToUserId'] = filters.assignedToUserId;
  if (filters.matterId) params['matterId'] = filters.matterId;
  if (filters.search) params['search'] = filters.search;
  if (filters.dueBefore) params['dueBefore'] = filters.dueBefore;
  if (filters.dueAfter) params['dueAfter'] = filters.dueAfter;

  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => apiClient.get<TaskListResponse>('/tasks', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => apiClient.get<TaskDetailResponse>(`/tasks/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskInput) =>
      apiClient.post<{ success: boolean; data: TaskListItem }>('/tasks', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateTaskInput & { id: string }) =>
      apiClient.patch<{ success: boolean; data: TaskListItem }>(
        `/tasks/${id}`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.id] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/tasks/${id}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () =>
      apiClient.get<{ success: boolean; data: TaskComment[] }>(
        `/tasks/${taskId}/comments`,
      ),
    enabled: !!taskId,
    staleTime: 60 * 1000,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: string }) =>
      apiClient.post<{ success: boolean; data: TaskComment }>(
        `/tasks/${taskId}/comments`,
        { body },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['task-comments', variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ['task', variables.taskId],
      });
    },
  });
}

export function useDeleteTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      commentId,
    }: {
      taskId: string;
      commentId: string;
    }) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/tasks/${taskId}/comments/${commentId}`,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['task-comments', variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ['task', variables.taskId],
      });
    },
  });
}
