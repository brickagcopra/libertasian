import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  CommunityEntityType,
  CreateRatingInput,
  MyRatingResponse,
  RatingsListResponse,
  UpsertRatingResponse,
} from '../types';

export function useRatings(
  entityType: CommunityEntityType,
  entityId: string,
  params?: { cursor?: string; limit?: number },
) {
  return useQuery({
    queryKey: ['community-ratings', entityType, entityId, params],
    queryFn: () => {
      const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
      if (params?.cursor) qp['cursor'] = params.cursor;
      return apiClient.get<RatingsListResponse>(
        `/community/ratings/${entityType}/${entityId}`,
        { params: qp },
      );
    },
    enabled: !!entityId,
  });
}

export function useMyRating(entityType: CommunityEntityType, entityId: string) {
  return useQuery({
    queryKey: ['my-rating', entityType, entityId],
    queryFn: () =>
      apiClient.get<MyRatingResponse['data']>(
        `/community/ratings/mine/${entityType}/${entityId}`,
      ),
    enabled: !!entityId,
  });
}

export function useUpsertRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRatingInput) =>
      apiClient.post<UpsertRatingResponse>('/community/ratings', data),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['community-ratings', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({
        queryKey: ['my-rating', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({ queryKey: ['marketplace-featured'] });
      queryClient.invalidateQueries({
        queryKey: [`marketplace-${variables.entityType.replace('_', '-')}s`],
      });
    },
  });
}

export function useDeleteRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ratingId,
    }: {
      ratingId: string;
      entityType: CommunityEntityType;
      entityId: string;
    }) => apiClient.delete(`/community/ratings/${ratingId}`),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['community-ratings', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({
        queryKey: ['my-rating', variables.entityType, variables.entityId],
      });
      queryClient.invalidateQueries({ queryKey: ['marketplace-featured'] });
    },
  });
}
