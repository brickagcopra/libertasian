import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  NoteFilters,
  NoteListResponse,
  NoteListItem,
  CreateNoteInput,
  UpdateNoteInput,
} from '../types';

export function useNotes(filters: NoteFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.matterId) params['matterId'] = filters.matterId;
  if (filters.visibility) params['visibility'] = filters.visibility;
  if (filters.search) params['search'] = filters.search;

  return useQuery({
    queryKey: ['notes', filters],
    queryFn: () => apiClient.get<NoteListResponse>('/notes', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: ['note', id],
    queryFn: () =>
      apiClient.get<{ success: boolean; data: NoteListItem }>(`/notes/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateNoteInput) =>
      apiClient.post<{ success: boolean; data: NoteListItem }>('/notes', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateNoteInput & { id: string }) =>
      apiClient.patch<{ success: boolean; data: NoteListItem }>(
        `/notes/${id}`,
        data,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['note', variables.id] });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean; data: { message: string } }>(
        `/notes/${id}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}
