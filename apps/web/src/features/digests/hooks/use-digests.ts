'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface Digest {
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

export interface DigestsListMeta {
  hasNext: boolean;
  cursor?: string | null;
  nextCursor?: string | null;
  limit?: number;
  previewMode?: boolean;
  lockedCount?: number;
  upgradeRequired?: boolean;
}

export function useDigests(
  params?: {
    digestType?: string;
    reviewStatus?: string;
    legalDocumentId?: string;
    cursor?: string;
  },
  options?: { enabled?: boolean },
) {
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
    enabled: options?.enabled ?? true,
  });
}

interface DigestsListResponse {
  success: boolean;
  data: Digest[];
  meta: DigestsListMeta;
}

export function useInfiniteDigests(params?: {
  digestType?: string;
  reviewStatus?: string;
  legalDocumentId?: string;
}) {
  return useInfiniteQuery({
    queryKey: ['digests', 'infinite', params],
    queryFn: async ({ pageParam }) => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params?.digestType) queryParams['digestType'] = params.digestType;
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.legalDocumentId)
        queryParams['legalDocumentId'] = params.legalDocumentId;
      if (pageParam) queryParams['cursor'] = pageParam;
      const res = await apiClient.get<DigestsListResponse>('/digests', {
        params: queryParams,
      });
      return res;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta?.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
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

export interface MatchedDocument {
  id: string;
  title: string;
  grNo: string | null;
  citationText: string | null;
}

export interface DigestSearchResponse {
  results: Digest[];
  hasMore: boolean;
  cursor: string | null;
  matchedDocuments: MatchedDocument[];
  previewMode?: boolean;
  lockedCount?: number;
  upgradeRequired?: boolean;
}

export function useSearchDigests(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['digests', 'search', query],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '20' };
      if (query) params['q'] = query;
      const res = await apiClient.get<{
        success: boolean;
        data: DigestSearchResponse;
      }>('/digests/search', { params });
      return res.data;
    },
    enabled: enabled && query.trim().length > 0,
  });
}

export function useGenerateOnDemand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (legalDocumentId: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: { jobId: string; status: string };
      }>('/digests/generate-on-demand', { legalDocumentId });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
