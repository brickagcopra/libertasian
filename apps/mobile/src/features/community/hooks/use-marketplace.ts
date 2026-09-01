import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ContributorProfileResponse,
  MarketplaceFeaturedResponse,
  MarketplaceListResponse,
  MarketplaceQueryParams,
} from '../types';

function buildParams(
  params?: MarketplaceQueryParams,
  cursor?: string,
): Record<string, string> {
  const qp: Record<string, string> = { limit: String(params?.limit ?? 20) };
  // The page cursor comes from `meta.nextCursor` of the previous page, so it
  // wins over any caller-supplied one.
  const c = cursor || params?.cursor;
  if (c) qp['cursor'] = c;
  if (params?.barSubject) qp['barSubject'] = params.barSubject;
  if (params?.search) qp['search'] = params.search;
  if (params?.sortBy) qp['sortBy'] = params.sortBy;
  return qp;
}

/**
 * The three browse lists page off `meta`, not `data`.
 *
 * Each response is `{ success, data: MarketplaceItem[], meta: { hasNext,
 * nextCursor } }`. The `meta` sibling is also what stops `apiClient` unwrapping
 * the envelope, which is why these hooks read `page.data` while the bare-envelope
 * ones in this file (featured, contributor) do not.
 *
 * Before this, the response type claimed `data: { items, hasNext, nextCursor }`;
 * `data.items` was `undefined`, every list rendered empty, and there was no
 * paging at all — the cursor the server sent was never read by anything.
 */
function useMarketplaceList(
  key: string,
  path: string,
  params?: MarketplaceQueryParams,
) {
  return useInfiniteQuery({
    queryKey: [key, params],
    queryFn: ({ pageParam }) =>
      apiClient.get<MarketplaceListResponse>(path, {
        params: buildParams(params, pageParam),
      }),
    initialPageParam: '' as string,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    select: (data) => ({
      items: data.pages.flatMap((p) => p.data),
      hasNext: data.pages[data.pages.length - 1]?.meta.hasNext ?? false,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketplaceFlashcardSets(params?: MarketplaceQueryParams) {
  return useMarketplaceList('marketplace-flashcard-sets', '/community/marketplace/flashcard-sets', params);
}

export function useMarketplaceReviewerPacks(params?: MarketplaceQueryParams) {
  return useMarketplaceList('marketplace-reviewer-packs', '/community/marketplace/reviewer-packs', params);
}

export function useMarketplaceDigests(params?: MarketplaceQueryParams) {
  return useMarketplaceList('marketplace-digests', '/community/marketplace/digests', params);
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
