'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ShareListResponse,
  ShareListItem,
  ShareCreateResult,
  CreateShareInput,
  UpdateShareInput,
} from '../types';

// -- List Shares --------------------------------------------------------------

interface UseSharesParams {
  entityType?: string;
  entityId?: string;
}

export function useShares(params?: UseSharesParams) {
  return useQuery({
    queryKey: ['shares', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.entityType) queryParams['entityType'] = params.entityType;
      if (params?.entityId) queryParams['entityId'] = params.entityId;

      return apiClient.get<ShareListResponse>('/shares', { params: queryParams });
    },
    enabled: !!params?.entityType && !!params?.entityId,
  });
}

// -- Create Share -------------------------------------------------------------

export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateShareInput) =>
      apiClient.post<{ success: boolean; data: ShareCreateResult }>('/shares', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['shares', { entityType: variables.entityType, entityId: variables.entityId }],
      });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });
}

// -- Update Share -------------------------------------------------------------

export function useUpdateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateShareInput & { id: string }) =>
      apiClient.patch<{ success: boolean; data: ShareListItem }>(`/shares/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });
}

// -- Revoke Share -------------------------------------------------------------

export function useRevokeShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/shares/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });
}
