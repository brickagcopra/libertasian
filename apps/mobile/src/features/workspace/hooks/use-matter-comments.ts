import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { MatterComment } from '../types';

export function useMatterComments(matterId: string | null) {
  return useQuery({
    queryKey: ['matter-comments', matterId],
    queryFn: () =>
      apiClient.get<{ success: boolean; data: MatterComment[] }>(
        `/matters/${matterId}/comments`,
      ),
    enabled: !!matterId,
    staleTime: 60 * 1000,
  });
}

export function useCreateMatterComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matterId, body }: { matterId: string; body: string }) =>
      apiClient.post<{ success: boolean; data: MatterComment }>(
        `/matters/${matterId}/comments`,
        { body },
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
    }) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/matters/${matterId}/comments/${commentId}`,
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
