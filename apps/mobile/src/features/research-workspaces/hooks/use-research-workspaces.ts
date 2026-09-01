import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
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
  const queryParams: Record<string, string> = {};
  if (params?.cursor) queryParams['cursor'] = params.cursor;
  if (params?.limit) queryParams['limit'] = String(params.limit);

  return useQuery({
    queryKey: ['research-workspaces', params],
    queryFn: () =>
      apiClient.get<WorkspaceListResponse>('/research-workspaces', {
        params: queryParams,
      }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useResearchWorkspace(id: string, enabled = true) {
  return useQuery({
    queryKey: ['research-workspace', id],
    // `GET /research-workspaces/:id` is a bare { success, data } envelope,
    // already stripped by `apiClient` — unlike the list and `/queries` routes
    // below, which carry `meta` and so keep theirs.
    queryFn: () =>
      apiClient.get<WorkspaceDetailResponse['data']>(
        `/research-workspaces/${id}`,
      ),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateResearchWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateWorkspaceInput) =>
      apiClient.post<ResearchWorkspaceListItem>('/research-workspaces', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-workspaces'] });
    },
  });
}

export function useUpdateResearchWorkspace(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateWorkspaceInput) =>
      apiClient.patch<ResearchWorkspaceListItem>(
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

export function useResearchQueries(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['research-queries', workspaceId],
    queryFn: () =>
      apiClient.get<QueryListResponse>(
        `/research-workspaces/${workspaceId}/queries`,
      ),
    enabled: enabled && workspaceId.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: (query) => {
      const resp = query.state.data as QueryListResponse | undefined;
      const queries = resp?.data;
      if (queries && queries.some((q: ResearchQueryListItem) => !q.responseJson)) {
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
