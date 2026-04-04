'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  TaskListResponse,
  TaskDetailResponse,
  TaskListItem,
  TaskDetail,
  TaskComment,
  TaskCommentListResponse,
  CreateTaskInput,
  UpdateTaskInput,
  CreateTaskCommentInput,
} from '../types';

// -- Tasks --------------------------------------------------------------------

interface UseTasksParams {
  status?: string;
  priority?: string;
  assignedToUserId?: string;
  matterId?: string;
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
  cursor?: string;
  limit?: number;
}

export function useTasks(params?: UseTasksParams) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.priority) queryParams['priority'] = params.priority;
      if (params?.assignedToUserId) queryParams['assignedToUserId'] = params.assignedToUserId;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.search) queryParams['search'] = params.search;
      if (params?.dueBefore) queryParams['dueBefore'] = params.dueBefore;
      if (params?.dueAfter) queryParams['dueAfter'] = params.dueAfter;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<TaskListResponse>('/tasks', { params: queryParams });
    },
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: async () => {
      const res = await apiClient.get<TaskDetailResponse>(`/tasks/${id}`);
      return res.data;
    },
    enabled: !!id,
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
      apiClient.patch<{ success: boolean; data: TaskListItem }>(`/tasks/${id}`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.id] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// -- Task Comments ------------------------------------------------------------

export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: async () => {
      const res = await apiClient.get<TaskCommentListResponse>(`/tasks/${taskId}/comments`);
      return res.data;
    },
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, ...data }: CreateTaskCommentInput & { taskId: string }) =>
      apiClient.post<{ success: boolean; data: TaskComment }>(`/tasks/${taskId}/comments`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, commentId }: { taskId: string; commentId: string }) =>
      apiClient.delete(`/tasks/${taskId}/comments/${commentId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
    },
  });
}
