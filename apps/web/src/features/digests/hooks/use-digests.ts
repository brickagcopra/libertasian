'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface Digest {
  id: string;
  title: string;
  digestType: string;
  sourceOrigin: string;
  reviewStatus: string;
  confidenceScore: number | null;
  visibility: string;
  summary: string | null;
  facts: string | null;
  petitionerArguments: string | null;
  respondentArguments: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    documentType: string;
    court: string | null;
    grNo: string | null;
  } | null;
}

interface DigestsListMeta {
  hasNext: boolean;
  cursor: string | null;
}

export function useDigests(params?: {
  digestType?: string;
  reviewStatus?: string;
  legalDocumentId?: string;
  cursor?: string;
}) {
  return useQuery({
    queryKey: ['digests', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params?.digestType) queryParams['digestType'] = params.digestType;
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.legalDocumentId) queryParams['legalDocumentId'] = params.legalDocumentId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      const res = await apiClient.get<{
        success: boolean;
        data: Digest[];
        meta: DigestsListMeta;
      }>('/digests', { params: queryParams });
      return res;
    },
  });
}

export function useDigest(id: string) {
  return useQuery({
    queryKey: ['digest', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: Digest }>(
        `/digests/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGenerateDigest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { legalDocumentId: string; digestType?: string }) =>
      apiClient.post<{ success: boolean; data: Digest }>('/digests/generate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
