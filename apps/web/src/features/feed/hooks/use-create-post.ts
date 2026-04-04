'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { FeedPostItem, FeedPostVisibility } from '@libertasian/types';

interface CreatePostParams {
  textContent: string;
  mediaId?: string;
  visibility?: FeedPostVisibility;
}

interface CreatePostResponse {
  success: boolean;
  data: FeedPostItem;
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreatePostParams) =>
      apiClient.post<CreatePostResponse>('/feed/posts', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
