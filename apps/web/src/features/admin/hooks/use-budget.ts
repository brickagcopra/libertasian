'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BudgetCurrentResponse, LedgerMonthSummary } from '../types';

/** Standard API response envelope from NestJS controllers */
type ApiEnvelope<T> = { success: boolean; data: T };

const budgetKeys = {
  current: ['budget', 'current'] as const,
  history: ['budget', 'history'] as const,
};

/** Fetch current budget snapshot + per-scope breakdown (30s auto-refresh). */
export function useBudgetSnapshot() {
  return useQuery({
    queryKey: budgetKeys.current,
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<BudgetCurrentResponse>>('/admin/budget/current');
      return res.data;
    },
    refetchInterval: 30000,
  });
}

/** Fetch monthly ledger history (last 12 months). */
export function useBudgetHistory() {
  return useQuery({
    queryKey: budgetKeys.history,
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<LedgerMonthSummary[]>>('/admin/budget/history?months=12');
      return res.data;
    },
  });
}

/** Update monthly and/or daily budget ceilings. */
export function useUpdateBudgetSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { monthlyCeilingUsd?: number; dailyCeilingUsd?: number }) => {
      const res = await apiClient.patch<ApiEnvelope<void>>('/admin/budget/settings', input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.current });
      queryClient.invalidateQueries({ queryKey: budgetKeys.history });
      // Also invalidate ai-settings queries since budget is shared
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}
