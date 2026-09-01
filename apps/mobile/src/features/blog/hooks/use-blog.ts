import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { BlogPost, BlogPostDetail, BlogTag } from '../types';

interface BlogListResponse {
  success: boolean;
  data: BlogPost[];
  meta: { hasNext: boolean; nextCursor?: string };
}

interface BlogPostResponse {
  success: boolean;
  data: BlogPostDetail;
}

interface BlogTagsResponse {
  success: boolean;
  data: BlogTag[];
}

export const blogKeys = {
  all: ['blog'] as const,
  posts: (tag?: string) => ['blog', 'posts', tag ?? ''] as const,
  post: (slug: string) => ['blog', 'post', slug] as const,
  tags: ['blog', 'tags'] as const,
};

export function useBlogPosts(tag?: string) {
  return useInfiniteQuery({
    queryKey: blogKeys.posts(tag),
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      if (tag) params['tag'] = tag;
      return apiClient.get<BlogListResponse>('/blog', { params, skipAuth: true });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
  });
}

export function useBlogPost(slug: string) {
  return useQuery({
    queryKey: blogKeys.post(slug),
    queryFn: () =>
      apiClient.get<BlogPostResponse['data']>(`/blog/${slug}`, { skipAuth: true }),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBlogTags() {
  return useQuery({
    queryKey: blogKeys.tags,
    queryFn: () =>
      apiClient.get<BlogTagsResponse['data']>('/blog/tags', { skipAuth: true }),
    staleTime: 10 * 60 * 1000,
  });
}
