import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { SearchFilters, SearchResponse, SuggestionItem } from '../types';

export function useSearch(filters: SearchFilters, enabled = true) {
  return useQuery({
    queryKey: ['search', filters],
    queryFn: () => apiClient.post<SearchResponse>('/search', filters),
    enabled: enabled && filters.query.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSuggestions(query: string) {
  return useQuery({
    queryKey: ['suggestions', query],
    queryFn: () =>
      apiClient.get<SuggestionItem[]>('/search/suggestions', {
        params: { q: query, limit: '8' },
      }),
    enabled: query.trim().length >= 2,
    staleTime: 60 * 1000,
  });
}
