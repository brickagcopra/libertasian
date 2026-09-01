import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ContributorProfileResponse,
  MarketplaceFeaturedResponse,
  MarketplaceListResponse,
  MarketplaceQueryParams,
} from '../types';

function buildParams(params?: MarketplaceQueryParams): Record<string, string> {
  const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
  if (params?.cursor) qp['cursor'] = params.cursor;
  if (params?.barSubject) qp['barSubject'] = params.barSubject;
  if (params?.search) qp['search'] = params.search;
  if (params?.sortBy) qp['sortBy'] = params.sortBy;
  return qp;
}

export function useMarketplaceFlashcardSets(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-flashcard-sets', params],
    queryFn: () =>
      apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/flashcard-sets',
        { params: buildParams(params) },
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketplaceReviewerPacks(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-reviewer-packs', params],
    queryFn: () =>
      apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/reviewer-packs',
        { params: buildParams(params) },
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketplaceDigests(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-digests', params],
    queryFn: () =>
      apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/digests',
        { params: buildParams(params) },
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketplaceFeatured() {
  return useQuery({
    queryKey: ['marketplace-featured'],
    queryFn: () =>
      apiClient.get<MarketplaceFeaturedResponse['data']>(
        '/community/marketplace/featured',
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useContributorProfile(userId: string) {
  return useQuery({
    queryKey: ['contributor-profile', userId],
    queryFn: () =>
      apiClient.get<ContributorProfileResponse['data']>(
        `/community/contributors/${userId}`,
      ),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
