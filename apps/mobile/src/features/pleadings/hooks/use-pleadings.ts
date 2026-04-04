import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  PleadingListResponse,
  PleadingDetailResponse,
  PleadingListItem,
  PleadingFilters,
  GeneratePleadingInput,
  PleadingTemplateListResponse,
  PleadingTemplateDetailResponse,
} from '../types';

export function usePleadings(filters: PleadingFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.templateId) params['templateId'] = filters.templateId;
  if (filters.category) params['category'] = filters.category;
  if (filters.matterId) params['matterId'] = filters.matterId;

  return useQuery({
    queryKey: ['pleadings', filters],
    queryFn: () =>
      apiClient.get<PleadingListResponse>('/pleadings', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function usePleading(id: string, enabled = true) {
  return useQuery({
    queryKey: ['pleading', id],
    queryFn: () =>
      apiClient.get<PleadingDetailResponse>(`/pleadings/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const resp = query.state.data as PleadingDetailResponse | undefined;
      const pleading = resp?.data;
      if (
        pleading &&
        (pleading.status === 'pending' || pleading.status === 'generating')
      ) {
        return 3000;
      }
      return false;
    },
  });
}

export function usePleadingTemplates(category?: string) {
  const params: Record<string, string> = {};
  if (category) params['category'] = category;

  return useQuery({
    queryKey: ['pleading-templates', category],
    queryFn: () =>
      apiClient.get<PleadingTemplateListResponse>('/pleadings/templates', {
        params,
      }),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePleadingTemplate(id: string, enabled = true) {
  return useQuery({
    queryKey: ['pleading-template', id],
    queryFn: () =>
      apiClient.get<PleadingTemplateDetailResponse>(
        `/pleadings/templates/${id}`,
      ),
    enabled: enabled && id.length > 0,
    staleTime: 10 * 60 * 1000,
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
