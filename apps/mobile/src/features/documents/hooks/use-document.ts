import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { LegalDocument, DocumentSection } from '../types';

export function useDocument(id: string, enabled = true) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => apiClient.get<LegalDocument>(`/documents/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDocumentSections(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['document-sections', documentId],
    queryFn: () =>
      apiClient.get<DocumentSection[]>(`/documents/${documentId}/sections`),
    enabled: enabled && documentId.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDocumentSection(
  documentId: string,
  sectionId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['document-section', documentId, sectionId],
    queryFn: () =>
      apiClient.get<DocumentSection>(
        `/documents/${documentId}/sections/${sectionId}`,
      ),
    enabled: enabled && documentId.length > 0 && sectionId.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
