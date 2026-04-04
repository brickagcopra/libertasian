'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { SearchDigestItem } from '../types';

interface BatchDigestsResponse {
  success: boolean;
  data: SearchDigestItem[];
}

export function useSearchDigests(
  documentIds: string[] | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['search-digests', documentIds],
    queryFn: async () => {
      if (!documentIds || documentIds.length === 0) return null;
      return apiClient.post<BatchDigestsResponse>('/digests/by-documents', {
        legalDocumentIds: documentIds,
      });
    },
    enabled: enabled && !!documentIds && documentIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
