'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { FeedCommentItem, FeedPaginationMeta } from '@libertasian/types';

interface CommentsResponse {
  success: boolean;
  data: FeedCommentItem[];
  meta: FeedPaginationMeta;
}

interface CreateCommentResponse {
  success: boolean;
  data: FeedCommentItem;
}

export function useComments(postId: string | null) {
  return useInfiniteQuery({
    queryKey: ['feed-comments', postId],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<CommentsResponse>(`/feed/posts/${postId}/comments`, { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    enabled: !!postId,
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { postId: string; textContent: string; parentId?: string }) =>
      apiClient.post<CreateCommentResponse>(`/feed/posts/${params.postId}/comments`, {
        textContent: params.textContent,
        parentId: params.parentId,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['feed-comments', variables.postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { commentId: string; textContent: string }) =>
      apiClient.patch<CreateCommentResponse>(`/feed/comments/${params.commentId}`, {
        textContent: params.textContent,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiClient.delete(`/feed/comments/${commentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useLikeComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiClient.post(`/feed/comments/${commentId}/like`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
    },
  });
}

export function useUnlikeComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiClient.delete(`/feed/comments/${commentId}/like`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
    },
  });
}
