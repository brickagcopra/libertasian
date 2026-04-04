'use client';

import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { CreateFlagInput } from '../types';

export function useCreateFlag() {
  return useMutation({
    mutationFn: (data: CreateFlagInput) =>
      apiClient.post<{ success: boolean; data: { id: string } }>(
        '/community/flags',
        data,
      ),
  });
}
