import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  DocumentFilters,
  DocumentListResponse,
  DocumentCitation,
  RelatedDocument,
} from '../types';

export function useDocuments(filters: DocumentFilters = {}) {
  const buildParams = (cursor?: string): Record<string, string> => {
    const params: Record<string, string> = {};
    if (filters.query?.trim()) params['query'] = filters.query.trim();
    if (filters.documentType) params['documentType'] = filters.documentType;
    if (filters.court) params['court'] = filters.court;
    if (filters.barSubjectCode)
      params['barSubjectCode'] = filters.barSubjectCode;
    if (filters.limit) params['limit'] = String(filters.limit);
    if (cursor) params['cursor'] = cursor;
    return params;
  };

  return useInfiniteQuery({
    queryKey: ['documents', filters],
    queryFn: ({ pageParam }) =>
      apiClient.get<DocumentListResponse>('/documents', {
        params: buildParams(pageParam as string | undefined),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDocumentCitations(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['document-citations', documentId],
    queryFn: () =>
      apiClient.get<DocumentCitation[]>(
        `/documents/${documentId}/citations`,
      ),
    enabled: enabled && documentId.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRelatedDocuments(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['document-related', documentId],
    queryFn: () =>
      apiClient.get<RelatedDocument[]>(
        `/documents/${documentId}/related`,
      ),
    enabled: enabled && documentId.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
