'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import type {
  DerivativeDetail,
  DerivativeListItem,
  DerivativeListMeta,
  DerivativeSubjectSummary,
  DerivativeTypeSubjectSummary,
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

export function useDerivative(id: string | undefined, asType?: string) {
  return useQuery({
    queryKey: ['derivatives', 'detail', id, asType],
    queryFn: async () => {
      // Bridged types (e.g. essay_model_answer) are projected from a foreign
      // artifact; the detail id is that artifact's UUID, so request the
      // projection via ?as=. Omit the param entirely for the normal path.
      const res = asType
        ? await apiClient.get<{ success: boolean; data: DerivativeDetail }>(
            `/derivatives/${id}`,
            { params: { as: asType } },
          )
        : await apiClient.get<{ success: boolean; data: DerivativeDetail }>(
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

export function useDerivativeSubjectsByType(
  type: string | undefined,
  taxonomyVersion = 'study_8',
) {
  return useQuery({
    queryKey: ['derivatives', 'subjects-by-type', type, taxonomyVersion],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: DerivativeTypeSubjectSummary[];
      }>(`/derivatives/types/${type}/subjects/summary`, {
        params: { taxonomyVersion },
      });
      return res.data;
    },
    enabled: !!type,
    staleTime: 5 * 60_000,
  });
}
