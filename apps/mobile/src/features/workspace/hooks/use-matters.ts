import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  MatterFilters,
  MatterListResponse,
  MatterDetailResponse,
  MatterListItem,
  CreateMatterInput,
  UpdateMatterInput,
} from '../types';

export function useMatters(filters: MatterFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.search) params['search'] = filters.search;

  return useQuery({
    queryKey: ['matters', filters],
    queryFn: () => apiClient.get<MatterListResponse>('/matters', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useMatter(id: string | null) {
  return useQuery({
    queryKey: ['matter', id],
    queryFn: () =>
      apiClient.get<MatterDetailResponse>(`/matters/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateMatter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMatterInput) =>
      apiClient.post<{ success: boolean; data: MatterListItem }>('/matters', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matters'] });
    },
  });
}

export function useUpdateMatter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateMatterInput & { id: string }) =>
      apiClient.patch<{ success: boolean; data: MatterListItem }>(
        `/matters/${id}`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matters'] });
      queryClient.invalidateQueries({ queryKey: ['matter', variables.id] });
    },
  });
}

export function useDeleteMatter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/matters/${id}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matters'] });
    },
  });
}

export function useMatterDocuments(matterId: string | null) {
  return useQuery({
    queryKey: ['matter-documents', matterId],
    queryFn: () =>
      apiClient.get<{ success: boolean; data: import('../types').MatterDocument[] }>(
        `/matters/${matterId}/documents`,
      ),
    enabled: !!matterId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAddMatterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      matterId,
      ...data
    }: {
      matterId: string;
      legalDocumentId?: string;
      userUploadId?: string;
      title?: string;
      role?: string;
    }) =>
      apiClient.post<{ success: boolean; data: import('../types').MatterDocument }>(
        `/matters/${matterId}/documents`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['matter-documents', variables.matterId],
      });
      queryClient.invalidateQueries({
        queryKey: ['matter', variables.matterId],
      });
    },
  });
}

export function useRemoveMatterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matterId, docId }: { matterId: string; docId: string }) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/matters/${matterId}/documents/${docId}`,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['matter-documents', variables.matterId],
      });
      queryClient.invalidateQueries({
        queryKey: ['matter', variables.matterId],
      });
    },
  });
}
