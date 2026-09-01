import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { FeedPostItem, FeedPaginationMeta, FeedPostDetail } from '@libertasian/types';

interface FeedResponse {
  success: boolean;
  data: FeedPostItem[];
  meta: FeedPaginationMeta;
}

interface PostDetailResponse {
  success: boolean;
  data: FeedPostDetail;
}

export function usePublicFeed() {
  return useInfiniteQuery({
    queryKey: ['feed', 'public'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<FeedResponse>('/feed', { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
  });
}

export function useOrganizationFeed() {
  return useInfiniteQuery({
    queryKey: ['feed', 'organization'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<FeedResponse>('/feed/organization', { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
  });
}

export function useUserProfileFeed(userId: string) {
  return useInfiniteQuery({
    queryKey: ['feed', 'user', userId],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<FeedResponse>(`/feed/user/${userId}`, { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    enabled: !!userId,
  });
}

export function useBookmarkedPosts() {
  return useInfiniteQuery({
    queryKey: ['feed', 'bookmarks'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<FeedResponse>('/feed/bookmarks', { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
  });
}

export function usePostDetail(postId: string) {
  return useQuery({
    queryKey: ['feed-post', postId],
    queryFn: () => apiClient.get<PostDetailResponse['data']>(`/feed/posts/${postId}`),
    enabled: !!postId,
    staleTime: 2 * 60 * 1000,
  });
}
