'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  PleadingListResponse,
  PleadingDetailResponse,
  PleadingDetail,
  PleadingListItem,
  PleadingFilters,
  GeneratePleadingInput,
  PleadingTemplateListResponse,
  PleadingTemplateDetailResponse,
  PleadingTemplateDetail,
} from '../types';

export function usePleadings(
  params?: PleadingFilters,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['pleadings', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.templateId) queryParams['templateId'] = params.templateId;
      if (params?.category) queryParams['category'] = params.category;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<PleadingListResponse>('/pleadings', { params: queryParams });
    },
    enabled: options?.enabled ?? true,
  });
}

export function usePleading(id: string | null) {
  return useQuery({
    queryKey: ['pleading', id],
    queryFn: async () => {
      const res = await apiClient.get<PleadingDetailResponse>(`/pleadings/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const pleading = query.state.data as PleadingDetail | undefined;
      if (pleading && (pleading.status === 'pending' || pleading.status === 'generating')) {
        return 3000;
      }
      return false;
    },
  });
}

export function usePleadingTemplates(category?: string) {
  return useQuery({
    queryKey: ['pleading-templates', category],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (category) queryParams['category'] = category;
      return apiClient.get<PleadingTemplateListResponse>('/pleadings/templates', { params: queryParams });
    },
  });
}

export function usePleadingTemplate(id: string | null) {
  return useQuery({
    queryKey: ['pleading-template', id],
    queryFn: async () => {
      const res = await apiClient.get<PleadingTemplateDetailResponse>(`/pleadings/templates/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGeneratePleading() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GeneratePleadingInput) =>
      apiClient.post<{ success: boolean; data: PleadingListItem }>(
        '/pleadings/generate',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pleadings'] });
    },
  });
}

export function useDeletePleading() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/pleadings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pleadings'] });
    },
  });
}
