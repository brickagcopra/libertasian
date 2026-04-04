'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AnnotationListResponse,
  Annotation,
  CreateAnnotationInput,
} from '../types';

export function useAnnotations(legalDocumentId?: string) {
  return useQuery({
    queryKey: ['annotations', legalDocumentId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (legalDocumentId) params['legalDocumentId'] = legalDocumentId;

      return apiClient.get<AnnotationListResponse>('/annotations', { params });
    },
  });
}

export function useCreateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAnnotationInput) =>
      apiClient.post<{ success: boolean; data: Annotation }>('/annotations', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['annotations', variables.legalDocumentId] });
      queryClient.invalidateQueries({ queryKey: ['annotations', undefined] });
    },
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/annotations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}
