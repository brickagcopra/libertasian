import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  DerivativeDetail,
  DerivativeSubjectSummary,
  DerivativesListResponse,
} from '../types';

interface UseDerivativesParams {
  subjectCode?: string;
  derivativeType?: string;
  taxonomyVersion?: string;
  search?: string;
}

export function useDerivatives(params: UseDerivativesParams = {}) {
  return useInfiniteQuery({
    queryKey: ['derivatives', 'list', params],
    queryFn: ({ pageParam }) => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params.subjectCode) queryParams['subjectCode'] = params.subjectCode;
      if (params.derivativeType) queryParams['derivativeType'] = params.derivativeType;
      if (params.taxonomyVersion) queryParams['taxonomyVersion'] = params.taxonomyVersion;
      if (params.search) queryParams['search'] = params.search;
      if (pageParam) queryParams['cursor'] = pageParam as string;
      return apiClient.get<DerivativesListResponse>('/derivatives', { params: queryParams });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? lastPage.meta.nextCursor : undefined,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDerivative(id: string, enabled = true) {
  return useQuery({
    queryKey: ['derivatives', 'detail', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DerivativeDetail }>(
        `/derivatives/${id}`,
      );
      return res.data;
    },
    enabled: enabled && id.length > 0,
    staleTime: 60 * 1000,
  });
}

export function useDerivativeSubjects(taxonomyVersion = 'study_8') {
  return useQuery({
    queryKey: ['derivatives', 'subjects', taxonomyVersion],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: DerivativeSubjectSummary[];
      }>('/derivatives/subjects/summary', { params: { taxonomyVersion } });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
