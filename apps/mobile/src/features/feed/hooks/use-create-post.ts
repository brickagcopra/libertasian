import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { FeedPostItem, FeedPostVisibility } from '@libertasian/types';

interface CreatePostParams {
  textContent: string;
  mediaId?: string;
  visibility?: FeedPostVisibility;
}

interface UpdatePostParams {
  postId: string;
  textContent?: string;
  visibility?: FeedPostVisibility;
}

interface PostResponse {
  success: boolean;
  data: FeedPostItem;
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreatePostParams) =>
      apiClient.post<PostResponse>('/feed/posts', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, ...body }: UpdatePostParams) =>
      apiClient.patch<PostResponse>(`/feed/posts/${postId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.delete(`/feed/posts/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
