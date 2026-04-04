import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { FeedPostItem, FeedPaginationMeta, FeedReportReason } from '@libertasian/types';

interface FeedResponse {
  success: boolean;
  data: FeedPostItem[];
  meta: FeedPaginationMeta;
}

function optimisticUpdate(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  updater: (post: FeedPostItem) => FeedPostItem,
) {
  const feedKeys = ['public', 'organization', 'bookmarks'] as const;
  for (const feedType of feedKeys) {
    queryClient.setQueriesData<InfiniteData<FeedResponse>>(
      { queryKey: ['feed', feedType] },
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.map((post) =>
              post.id === postId ? updater(post) : post,
            ),
          })),
        };
      },
    );
  }
}

export function useLikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.post(`/feed/posts/${postId}/like`),
    onMutate: async (postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isLikedByMe: true,
        likeCount: post.likeCount + 1,
      }));
    },
    onError: (_err, postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isLikedByMe: false,
        likeCount: Math.max(0, post.likeCount - 1),
      }));
    },
  });
}

export function useUnlikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.delete(`/feed/posts/${postId}/like`),
    onMutate: async (postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isLikedByMe: false,
        likeCount: Math.max(0, post.likeCount - 1),
      }));
    },
    onError: (_err, postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isLikedByMe: true,
        likeCount: post.likeCount + 1,
      }));
    },
  });
}

export function useBookmarkPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.post(`/feed/posts/${postId}/bookmark`),
    onMutate: async (postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isBookmarkedByMe: true,
        bookmarkCount: post.bookmarkCount + 1,
      }));
    },
    onError: (_err, postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isBookmarkedByMe: false,
        bookmarkCount: Math.max(0, post.bookmarkCount - 1),
      }));
    },
  });
}

export function useUnbookmarkPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.delete(`/feed/posts/${postId}/bookmark`),
    onMutate: async (postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isBookmarkedByMe: false,
        bookmarkCount: Math.max(0, post.bookmarkCount - 1),
      }));
    },
    onError: (_err, postId) => {
      optimisticUpdate(queryClient, postId, (post) => ({
        ...post,
        isBookmarkedByMe: true,
        bookmarkCount: post.bookmarkCount + 1,
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed', 'bookmarks'] });
    },
  });
}

export function useReportPost() {
  return useMutation({
    mutationFn: (params: { postId: string; reason: FeedReportReason; details?: string }) =>
      apiClient.post(`/feed/posts/${params.postId}/report`, {
        reason: params.reason,
        details: params.details,
      }),
  });
}
