import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  BookmarkFilters,
  BookmarksResponse,
  Bookmark,
  CreateBookmarkRequest,
} from '../types';

export function useBookmarks(filters: BookmarkFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.legalDocumentId)
    params['legalDocumentId'] = filters.legalDocumentId;

  return useQuery({
    queryKey: ['bookmarks', filters],
    queryFn: () => apiClient.get<BookmarksResponse>('/bookmarks', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateBookmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBookmarkRequest) =>
      apiClient.post<Bookmark>('/bookmarks', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
}

export function useDeleteBookmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ message: string }>(`/bookmarks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
}
