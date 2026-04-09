'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

// ---- Types ----

interface AiSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

interface UsageSummary {
  tokensIn: number;
  tokensOut: number;
  requestCount: number;
  estimatedCostUsd: number;
  budgetUsd: number;
  budgetRemainingUsd: number;
  utilizationPercent: number;
  month: string;
}

// ---- Query Keys ----

const aiSettingsKeys = {
  all: ['ai-settings'] as const,
  usage: ['ai-settings', 'usage'] as const,
  usageHistory: ['ai-settings', 'usage-history'] as const,
};

// ---- Hooks ----

/** Fetch all AI settings. */
export function useAiSettings() {
  return useQuery({
    queryKey: aiSettingsKeys.all,
    queryFn: async () => {
      const res = await apiClient.get<AiSetting[]>('/admin/ai-settings');
      return res.data;
    },
  });
}

/** Fetch current month LLM usage with 30-second auto-refresh. */
export function useAiUsage() {
  return useQuery({
    queryKey: aiSettingsKeys.usage,
    queryFn: async () => {
      const res = await apiClient.get<UsageSummary>('/admin/ai-settings/usage/current');
      return res.data;
    },
    refetchInterval: 30000,
  });
}

/** Fetch LLM usage history (last 12 months). */
export function useAiUsageHistory() {
  return useQuery({
    queryKey: aiSettingsKeys.usageHistory,
    queryFn: async () => {
      const res = await apiClient.get<UsageSummary[]>('/admin/ai-settings/usage/history?months=12');
      return res.data;
    },
  });
}

/** Update an AI setting (optimistic). */
export function useUpdateAiSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, unknown> }) => {
      const res = await apiClient.patch<{ success: boolean }>(`/admin/ai-settings/${key}`, {
        value,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usage });
    },
  });
}

/** Trigger an ingestion run for a specific source. */
export function useRunIngestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await apiClient.post<{ success: boolean }>(`/admin/sources/${sourceId}/fetch`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
    },
  });
}

/** Emergency reset of monthly usage counters. */
export function useResetUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (month: string) => {
      const res = await apiClient.post<{ success: boolean }>('/admin/ai-settings/usage/reset', {
        month,
        confirmation: 'RESET',
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usage });
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usageHistory });
    },
  });
}
