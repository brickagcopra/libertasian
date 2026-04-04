'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { SearchFilters, SearchResponse } from '../types';

export function useSearch(filters: SearchFilters | null) {
  return useQuery({
    queryKey: ['search', filters],
    queryFn: async () => {
      if (!filters?.query) return null;
      const body: Record<string, unknown> = { query: filters.query };
      if (filters.documentType) body['documentType'] = filters.documentType;
      if (filters.court) body['court'] = filters.court;
      if (filters.ponente) body['ponente'] = filters.ponente;
      if (filters.grNo) body['grNo'] = filters.grNo;
      if (filters.dateFrom) body['dateFrom'] = filters.dateFrom;
      if (filters.dateTo) body['dateTo'] = filters.dateTo;
      if (filters.publishedOnly != null) body['publishedOnly'] = filters.publishedOnly;
      if (filters.page != null) body['page'] = filters.page;
      if (filters.limit != null) body['limit'] = filters.limit;

      return apiClient.post<SearchResponse>('/search', body);
    },
    enabled: !!filters?.query,
  });
}

export function useSuggestions(prefix: string) {
  return useQuery({
    queryKey: ['suggestions', prefix],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: string[] }>(
        '/search/suggestions',
        { params: { q: prefix } },
      );
      return res.data;
    },
    enabled: prefix.length >= 2,
    staleTime: 30 * 1000,
  });
}
