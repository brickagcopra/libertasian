'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  WorkspaceListResponse,
  WorkspaceDetailResponse,
  QueryListResponse,
  QueryCreateResponse,
  ResearchWorkspaceListItem,
  ResearchQueryListItem,
  WorkspaceFilters,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  AskQueryInput,
} from '../types';

// ─── Workspace CRUD ────────────────────────────────────────

export function useResearchWorkspaces(params?: WorkspaceFilters) {
  return useQuery({
    queryKey: ['research-workspaces', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<WorkspaceListResponse>('/research-workspaces', {
        params: queryParams,
      });
    },
  });
}

export function useResearchWorkspace(id: string | null) {
  return useQuery({
    queryKey: ['research-workspace', id],
    queryFn: async () => {
      const res = await apiClient.get<WorkspaceDetailResponse>(
        `/research-workspaces/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateResearchWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateWorkspaceInput) =>
      apiClient.post<{ success: boolean; data: ResearchWorkspaceListItem }>(
        '/research-workspaces',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-workspaces'] });
    },
  });
}

export function useUpdateResearchWorkspace(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateWorkspaceInput) =>
      apiClient.patch<{ success: boolean; data: ResearchWorkspaceListItem }>(
        `/research-workspaces/${id}`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['research-workspace', id] });
    },
  });
}

export function useDeleteResearchWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/research-workspaces/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-workspaces'] });
    },
  });
}

// ─── Query Operations ──────────────────────────────────────

export function useResearchQueries(workspaceId: string | null) {
  return useQuery({
    queryKey: ['research-queries', workspaceId],
    queryFn: async () => {
      const res = await apiClient.get<QueryListResponse>(
        `/research-workspaces/${workspaceId}/queries`,
      );
      return res.data;
    },
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const data = query.state.data as ResearchQueryListItem[] | undefined;
      // Poll while any query has no response yet
      if (data && data.some((q) => !q.responseJson)) {
        return 3000;
      }
      return false;
    },
  });
}

export function useAskResearchQuery(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AskQueryInput) =>
      apiClient.post<QueryCreateResponse>(
        `/research-workspaces/${workspaceId}/queries`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['research-queries', workspaceId],
      });
    },
  });
}
