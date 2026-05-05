import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ApiKeyDetail,
  ApiKeyListItem,
  ApiKeyFilters,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from '../types';

interface ApiKeyListData {
  data: ApiKeyListItem[];
  cursor: string | null;
  hasNext: boolean;
}

interface ApiKeyCreateData {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
}

export function useApiKeys(params?: ApiKeyFilters) {
  const queryParams: Record<string, string> = {
    limit: String(params?.limit ?? 20),
  };
  if (params?.cursor) queryParams['cursor'] = params.cursor;

  return useQuery({
    queryKey: ['api-keys', params],
    queryFn: () =>
      apiClient.get<ApiKeyListData>('/api-keys', { params: queryParams }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useApiKey(id: string | null) {
  return useQuery({
    queryKey: ['api-key', id],
    queryFn: () => apiClient.get<ApiKeyDetail>(`/api-keys/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyInput) =>
      apiClient.post<ApiKeyCreateData>('/api-keys', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApiKeyInput }) =>
      apiClient.patch<ApiKeyDetail>(`/api-keys/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
