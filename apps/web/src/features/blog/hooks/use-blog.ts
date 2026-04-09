'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  BlogPost,
  BlogPostDetail,
  BlogTag,
  CreateBlogPostInput,
  UpdateBlogPostInput,
} from '../types';

// ─── Query Keys ──────────────────────────────────

export const blogKeys = {
  all: ['blog'] as const,
  posts: () => [...blogKeys.all, 'posts'] as const,
  postList: (filters?: Record<string, unknown>) => [...blogKeys.posts(), filters] as const,
  postDetail: (slug: string) => [...blogKeys.all, 'post', slug] as const,
  tags: () => [...blogKeys.all, 'tags'] as const,
  admin: () => [...blogKeys.all, 'admin'] as const,
  adminPosts: (filters?: Record<string, unknown>) => [...blogKeys.admin(), 'posts', filters] as const,
  adminPost: (id: string) => [...blogKeys.admin(), 'post', id] as const,
  adminTags: () => [...blogKeys.admin(), 'tags'] as const,
};

// ─── Public Queries ──────────────────────────────

export function useBlogPosts(tag?: string, cursor?: string) {
  return useQuery({
    queryKey: blogKeys.postList({ tag, cursor }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tag) params.set('tag', tag);
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<{
        success: boolean;
        data: BlogPost[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>(`/blog?${params.toString()}`);
      return res;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useBlogPost(slug: string) {
  return useQuery({
    queryKey: blogKeys.postDetail(slug),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BlogPostDetail;
      }>(`/blog/${slug}`);
      return res.data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBlogTags() {
  return useQuery({
    queryKey: blogKeys.tags(),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BlogTag[];
      }>('/blog/tags');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Admin Queries ───────────────────────────────

export function useAdminBlogPosts(status?: string, cursor?: string) {
  return useQuery({
    queryKey: blogKeys.adminPosts({ status, cursor }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<{
        success: boolean;
        data: BlogPostDetail[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>(`/admin/blog?${params.toString()}`);
      return res;
    },
  });
}

export function useAdminBlogPost(id: string) {
  return useQuery({
    queryKey: blogKeys.adminPost(id),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BlogPostDetail;
      }>(`/admin/blog/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useAdminBlogTags() {
  return useQuery({
    queryKey: blogKeys.adminTags(),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BlogTag[];
      }>('/admin/blog/tags/all');
      return res.data;
    },
  });
}

// ─── Admin Mutations ─────────────────────────────

export function useCreateBlogPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBlogPostInput) => {
      const res = await apiClient.post<{ success: boolean; data: BlogPostDetail }>(
        '/admin/blog',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminPosts() });
      qc.invalidateQueries({ queryKey: blogKeys.posts() });
    },
  });
}

export function useUpdateBlogPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateBlogPostInput & { id: string }) => {
      const res = await apiClient.put<{ success: boolean; data: BlogPostDetail }>(
        `/admin/blog/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: blogKeys.adminPost(id) });
      qc.invalidateQueries({ queryKey: blogKeys.adminPosts() });
      qc.invalidateQueries({ queryKey: blogKeys.posts() });
    },
  });
}

export function useDeleteBlogPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/blog/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminPosts() });
      qc.invalidateQueries({ queryKey: blogKeys.posts() });
    },
  });
}

export function useUploadBlogCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<{ success: boolean; data: { coverImageUrl: string } }>(
        `/admin/blog/${id}/upload-cover`,
        formData,
      );
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: blogKeys.adminPost(id) });
    },
  });
}

export function useCreateBlogTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string }) => {
      const res = await apiClient.post<{ success: boolean; data: BlogTag }>(
        '/admin/blog/tags',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminTags() });
      qc.invalidateQueries({ queryKey: blogKeys.tags() });
    },
  });
}

export function useDeleteBlogTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/blog/tags/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminTags() });
      qc.invalidateQueries({ queryKey: blogKeys.tags() });
    },
  });
}
