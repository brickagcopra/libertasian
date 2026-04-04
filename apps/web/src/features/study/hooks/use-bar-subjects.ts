'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BarSubject } from '../types';

export function useBarSubjects() {
  return useQuery({
    queryKey: ['bar-subjects'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BarSubject[];
      }>('/study/bar-subjects');
      return res;
    },
    staleTime: 5 * 60 * 1000, // bar subjects rarely change
  });
}
