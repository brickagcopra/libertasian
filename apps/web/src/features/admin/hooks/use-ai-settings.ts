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

/** Standard API response envelope from NestJS controllers */
type ApiEnvelope<T> = { success: boolean; data: T };

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
      const res = await apiClient.get<ApiEnvelope<AiSetting[]>>('/admin/ai-settings');
      return res.data;
    },
  });
}

/** Fetch current month LLM usage with 30-second auto-refresh. */
export function useAiUsage() {
  return useQuery({
    queryKey: aiSettingsKeys.usage,
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<UsageSummary>>('/admin/ai-settings/usage/current');
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
      const res = await apiClient.get<ApiEnvelope<UsageSummary[]>>('/admin/ai-settings/usage/history?months=12');
      return res.data;
    },
  });
}

/** Update an AI setting (optimistic). */
export function useUpdateAiSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, unknown> }) => {
      await apiClient.patch<ApiEnvelope<void>>(`/admin/ai-settings/${key}`, {
        value,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usage });
    },
  });
}

/**
 * Update the global LLM budget ceilings (monthly + optional daily) in one
 * call. Backs the §7.2 admin budget form. Pass `dailyBudgetUsd: null` to
 * explicitly clear an existing daily cap.
 */
export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      monthlyBudgetUsd: number;
      dailyBudgetUsd?: number | null;
    }) => {
      await apiClient.patch<ApiEnvelope<void>>(
        '/admin/ai-settings/budget',
        input,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usage });
    },
  });
}

/**
 * Update the global ingestion wall-clock window (§7.3). All three fields
 * (startLocal, stopLocal, timezone) move together.
 */
export function useUpdateIngestionWindow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      startLocal: string;
      stopLocal: string;
      timezone: string;
    }) => {
      await apiClient.patch<ApiEnvelope<void>>(
        '/admin/ai-settings/ingestion-window',
        input,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.all });
    },
  });
}

/** Trigger an ingestion run for a specific source. */
export function useRunIngestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceId: string) => {
      await apiClient.post<ApiEnvelope<void>>(`/admin/sources/${sourceId}/fetch`);
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
      await apiClient.post<ApiEnvelope<void>>('/admin/ai-settings/usage/reset', {
        month,
        confirmation: 'RESET',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usage });
      queryClient.invalidateQueries({ queryKey: aiSettingsKeys.usageHistory });
    },
  });
}
