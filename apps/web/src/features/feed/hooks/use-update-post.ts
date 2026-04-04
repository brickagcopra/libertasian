'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { FeedPostItem, FeedPostVisibility } from '@libertasian/types';

interface UpdatePostParams {
  postId: string;
  textContent?: string;
  visibility?: FeedPostVisibility;
}

interface UpdatePostResponse {
  success: boolean;
  data: FeedPostItem;
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, ...body }: UpdatePostParams) =>
      apiClient.patch<UpdatePostResponse>(`/feed/posts/${postId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
