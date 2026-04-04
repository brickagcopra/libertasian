'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface Bookmark {
  id: string;
  userId: string;
  legalDocumentId: string;
  note: string | null;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle: string | null;
    documentType: string;
    court: string | null;
    grNo: string | null;
    decisionDate: string | null;
  };
}

interface BookmarkListMeta {
  hasNext: boolean;
  cursor: string | null;
}

export function useBookmarks(cursor?: string) {
  return useQuery({
    queryKey: ['bookmarks', cursor],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '20' };
      if (cursor) params['cursor'] = cursor;
      const res = await apiClient.get<{
        success: boolean;
        data: Bookmark[];
        meta: BookmarkListMeta;
      }>('/bookmarks', { params });
      return res;
    },
  });
}

export function useCreateBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { legalDocumentId: string; note?: string }) => {
      return apiClient.post<{ success: boolean; data: Bookmark }>('/bookmarks', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
}

export function useDeleteBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/bookmarks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
}
