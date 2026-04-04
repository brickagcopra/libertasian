'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  MatterComment,
  MatterCommentListResponse,
  CreateMatterCommentInput,
} from '../types';

export function useMatterComments(matterId: string | null) {
  return useQuery({
    queryKey: ['matter-comments', matterId],
    queryFn: async () => {
      const res = await apiClient.get<MatterCommentListResponse>(
        `/matters/${matterId}/comments`,
      );
      return res.data;
    },
    enabled: !!matterId,
  });
}

export function useCreateMatterComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      matterId,
      ...data
    }: CreateMatterCommentInput & { matterId: string }) =>
      apiClient.post<{ success: boolean; data: MatterComment }>(
        `/matters/${matterId}/comments`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['matter-comments', variables.matterId],
      });
      queryClient.invalidateQueries({
        queryKey: ['matter', variables.matterId],
      });
    },
  });
}

export function useDeleteMatterComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      matterId,
      commentId,
    }: {
      matterId: string;
      commentId: string;
    }) => apiClient.delete(`/matters/${matterId}/comments/${commentId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['matter-comments', variables.matterId],
      });
      queryClient.invalidateQueries({
        queryKey: ['matter', variables.matterId],
      });
    },
  });
}
