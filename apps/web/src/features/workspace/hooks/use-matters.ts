'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  MatterListResponse,
  MatterDetailResponse,
  MatterListItem,
  MatterDetail,
  MatterDocument,
  CreateMatterInput,
  UpdateMatterInput,
  AddMatterDocumentInput,
} from '../types';

// -- Matters ------------------------------------------------------------------

interface UseMattersParams {
  status?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export function useMatters(
  params?: UseMattersParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['matters', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.search) queryParams['search'] = params.search;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<MatterListResponse>('/matters', { params: queryParams });
    },
    enabled: options?.enabled ?? true,
  });
}

export function useMatter(id: string | null) {
  return useQuery({
    queryKey: ['matter', id],
    queryFn: async () => {
      const res = await apiClient.get<MatterDetailResponse>(`/matters/${id}`);
      return res.data;
    },
    enabled: !!id,
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
      apiClient.patch<{ success: boolean; data: MatterListItem }>(`/matters/${id}`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matters'] });
      queryClient.invalidateQueries({ queryKey: ['matter', variables.id] });
    },
  });
}

export function useDeleteMatter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/matters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matters'] });
    },
  });
}

// -- Matter Documents ---------------------------------------------------------

export function useMatterDocuments(matterId: string | null) {
  return useQuery({
    queryKey: ['matter-documents', matterId],
    queryFn: () =>
      apiClient.get<{ success: boolean; data: MatterDocument[] }>(
        `/matters/${matterId}/documents`,
      ),
    enabled: !!matterId,
  });
}

export function useAddMatterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matterId, ...data }: AddMatterDocumentInput & { matterId: string }) =>
      apiClient.post<{ success: boolean; data: MatterDocument }>(
        `/matters/${matterId}/documents`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matter-documents', variables.matterId] });
      queryClient.invalidateQueries({ queryKey: ['matter', variables.matterId] });
    },
  });
}

export function useRemoveMatterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matterId, docId }: { matterId: string; docId: string }) =>
      apiClient.delete(`/matters/${matterId}/documents/${docId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matter-documents', variables.matterId] });
      queryClient.invalidateQueries({ queryKey: ['matter', variables.matterId] });
    },
  });
}
