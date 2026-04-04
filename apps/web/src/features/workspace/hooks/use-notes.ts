'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  NoteListResponse,
  NoteDetailResponse,
  Note,
  CreateNoteInput,
  UpdateNoteInput,
} from '../types';

interface UseNotesParams {
  matterId?: string;
  visibility?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export function useNotes(params?: UseNotesParams) {
  return useQuery({
    queryKey: ['notes', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.visibility) queryParams['visibility'] = params.visibility;
      if (params?.search) queryParams['search'] = params.search;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<NoteListResponse>('/notes', { params: queryParams });
    },
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: ['note', id],
    queryFn: async () => {
      const res = await apiClient.get<NoteDetailResponse>(`/notes/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateNoteInput) =>
      apiClient.post<{ success: boolean; data: Note }>('/notes', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateNoteInput & { id: string }) =>
      apiClient.patch<{ success: boolean; data: Note }>(`/notes/${id}`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['note', variables.id] });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}
