import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { Annotation, CreateAnnotationRequest } from '../types';

/**
 * List annotations, optionally scoped to a document. The API has no sectionId
 * filter — fetch per document and group client-side.
 */
export function useAnnotations(legalDocumentId?: string) {
  const params: Record<string, string> = {};
  if (legalDocumentId) params['legalDocumentId'] = legalDocumentId;

  return useQuery({
    queryKey: ['annotations', legalDocumentId],
    queryFn: () => apiClient.get<Annotation[]>('/annotations', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAnnotationRequest) =>
      apiClient.post<Annotation>('/annotations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ message: string }>(`/annotations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}
