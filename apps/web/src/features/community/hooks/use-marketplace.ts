'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  ContributorProfileResponse,
  MarketplaceFeaturedResponse,
  MarketplaceListResponse,
  MarketplaceQueryParams,
} from '../types';

export function useMarketplaceFlashcardSets(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-flashcard-sets', params],
    queryFn: async () => {
      const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
      if (params?.cursor) qp['cursor'] = params.cursor;
      if (params?.barSubject) qp['barSubject'] = params.barSubject;
      if (params?.search) qp['search'] = params.search;
      if (params?.sortBy) qp['sortBy'] = params.sortBy;
      return apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/flashcard-sets',
        { params: qp },
      );
    },
  });
}

export function useMarketplaceReviewerPacks(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-reviewer-packs', params],
    queryFn: async () => {
      const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
      if (params?.cursor) qp['cursor'] = params.cursor;
      if (params?.barSubject) qp['barSubject'] = params.barSubject;
      if (params?.search) qp['search'] = params.search;
      if (params?.sortBy) qp['sortBy'] = params.sortBy;
      return apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/reviewer-packs',
        { params: qp },
      );
    },
  });
}

export function useMarketplaceDigests(params?: MarketplaceQueryParams) {
  return useQuery({
    queryKey: ['marketplace-digests', params],
    queryFn: async () => {
      const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
      if (params?.cursor) qp['cursor'] = params.cursor;
      if (params?.barSubject) qp['barSubject'] = params.barSubject;
      if (params?.search) qp['search'] = params.search;
      if (params?.sortBy) qp['sortBy'] = params.sortBy;
      return apiClient.get<MarketplaceListResponse>(
        '/community/marketplace/digests',
        { params: qp },
      );
    },
  });
}

export function useMarketplaceFeatured() {
  return useQuery({
    queryKey: ['marketplace-featured'],
    queryFn: () =>
      apiClient.get<MarketplaceFeaturedResponse>(
        '/community/marketplace/featured',
      ),
  });
}

export function useContributorProfile(userId: string) {
  return useQuery({
    queryKey: ['contributor-profile', userId],
    queryFn: () =>
      apiClient.get<ContributorProfileResponse>(
        `/community/contributors/${userId}`,
      ),
    enabled: !!userId,
  });
}
