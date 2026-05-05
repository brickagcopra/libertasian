import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { MyVoteResponse, VoteResponse, VoteType } from '../types';

export function useMyVote(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ['my-vote', entityType, entityId],
    queryFn: () =>
      apiClient.get<MyVoteResponse>(
        `/community/votes/mine/${entityType}/${entityId}`,
      ),
    enabled: !!entityId,
  });
}

export function useUpsertVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
      voteType,
    }: {
      entityType: string;
      entityId: string;
      voteType: VoteType;
    }) =>
      apiClient.put<VoteResponse>(
        `/community/votes/${entityType}/${entityId}`,
        { voteType },
      ),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['my-vote', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({ queryKey: ['marketplace-digests'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-featured'] });
    },
  });
}

export function useRemoveVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
    }: {
      entityType: string;
      entityId: string;
    }) =>
      apiClient.delete(`/community/votes/${entityType}/${entityId}`),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['my-vote', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({ queryKey: ['marketplace-digests'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-featured'] });
    },
  });
}
