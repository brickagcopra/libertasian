'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AutoPromoteStatusResponse,
  AutoPromoteSweepResponse,
} from '../types';

export type AutoPromoteStatus = AutoPromoteStatusResponse;
export type AutoPromoteSweepResult = AutoPromoteSweepResponse;

export const AUTO_PROMOTE_STATUS_QUERY_KEY = ['admin', 'auto-promote-status'] as const;

export function useAutoPromoteStatus() {
  return useQuery({
    queryKey: AUTO_PROMOTE_STATUS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: AutoPromoteStatusResponse;
      }>('/admin/auto-promote/status');
      return res.data;
    },
    refetchInterval: 5000,
  });
}

export { useTriggerAutoPromoteSweep } from './use-admin';
