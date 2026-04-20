'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import type {
  DerivativeDetail,
  DerivativeListItem,
  DerivativeListMeta,
  DerivativeSubjectSummary,
} from '../types';

interface UseDerivativesParams {
  subjectCode?: string;
  derivativeType?: string;
  taxonomyVersion?: string;
  search?: string;
}

interface ListResponse {
  success: boolean;
  data: DerivativeListItem[];
  meta: DerivativeListMeta;
}

export function useDerivatives(params: UseDerivativesParams = {}) {
  return useInfiniteQuery({
    queryKey: ['derivatives', 'list', params],
    queryFn: async ({ pageParam }) => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params.subjectCode) queryParams['subjectCode'] = params.subjectCode;
      if (params.derivativeType) queryParams['derivativeType'] = params.derivativeType;
      if (params.taxonomyVersion) queryParams['taxonomyVersion'] = params.taxonomyVersion;
      if (params.search) queryParams['search'] = params.search;
      if (pageParam) queryParams['cursor'] = pageParam;
      return apiClient.get<ListResponse>('/derivatives', { params: queryParams });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? lastPage.meta.nextCursor : undefined,
    staleTime: 2 * 60_000,
  });
}

export function useDerivative(id: string | undefined) {
  return useQuery({
    queryKey: ['derivatives', 'detail', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DerivativeDetail }>(
        `/derivatives/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useDerivativeSubjects(taxonomyVersion = 'study_8') {
  return useQuery({
    queryKey: ['derivatives', 'subjects', taxonomyVersion],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: DerivativeSubjectSummary[];
      }>('/derivatives/subjects/summary', {
        params: { taxonomyVersion },
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}
