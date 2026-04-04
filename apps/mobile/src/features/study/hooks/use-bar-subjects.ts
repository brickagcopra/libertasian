import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { BarSubject } from '../types';

export function useBarSubjects() {
  return useQuery({
    queryKey: ['study', 'bar-subjects'],
    queryFn: () => apiClient.get<BarSubject[]>('/study/bar-subjects'),
    staleTime: 5 * 60 * 1000,
  });
}
