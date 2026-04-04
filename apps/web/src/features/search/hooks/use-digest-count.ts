'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface DigestCountResponse {
  success: boolean;
  data: { count: number };
}

/**
 * Lightweight query to fetch the number of digests matching a set of document IDs.
 * Used to display a count badge on the Digests tab without loading full digest objects.
 */
export function useDigestCount(
  documentIds: string[] | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['digest-count', documentIds],
    queryFn: async () => {
      if (!documentIds || documentIds.length === 0) return 0;
      const res = await apiClient.post<DigestCountResponse>('/digests/by-documents/count', {
        legalDocumentIds: documentIds,
      });
      return res.data.count;
    },
    enabled: enabled && !!documentIds && documentIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
