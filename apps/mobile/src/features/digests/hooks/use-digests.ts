import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { Digest, DigestFilters, DigestsResponse } from '../types';

export function useDigests(filters: DigestFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.digestType) params['digestType'] = filters.digestType;
  if (filters.reviewStatus) params['reviewStatus'] = filters.reviewStatus;
  if (filters.legalDocumentId)
    params['legalDocumentId'] = filters.legalDocumentId;
  if (filters.barSubjectCode)
    params['barSubjectCode'] = filters.barSubjectCode;
  if (filters.sourceOrigin) params['sourceOrigin'] = filters.sourceOrigin;
  if (filters.visibility) params['visibility'] = filters.visibility;
  if (filters.orderBy) params['orderBy'] = filters.orderBy;
  if (filters.orderDirection)
    params['orderDirection'] = filters.orderDirection;

  return useQuery({
    queryKey: ['digests', filters],
    queryFn: () => apiClient.get<DigestsResponse>('/digests', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useDigest(id: string, enabled = true) {
  return useQuery({
    queryKey: ['digest', id],
    queryFn: () => apiClient.get<Digest>(`/digests/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGenerateDigest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { legalDocumentId: string; digestType?: string }) =>
      apiClient.post<{ success: boolean; data: Digest }>(
        '/digests/generate',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
