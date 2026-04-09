'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AdminLifecycleEventListResponse,
  LifecycleEventStatsResponse,
  ListLifecycleEventsQuery,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────

export const lifecycleEventKeys = {
  all: ['admin', 'lifecycle-events'] as const,
  list: (params?: ListLifecycleEventsQuery) =>
    [...lifecycleEventKeys.all, 'list', params ?? {}] as const,
  stats: () => [...lifecycleEventKeys.all, 'stats'] as const,
};

// ─── Queries ─────────────────────────────────────────────

/** Fetch paginated lifecycle events with optional filters */
export function useAdminLifecycleEvents(params?: ListLifecycleEventsQuery) {
  return useQuery({
    queryKey: lifecycleEventKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.status) searchParams.set('status', params.status);
      if (params?.eventType) searchParams.set('eventType', params.eventType);
      if (params?.subscriptionId) searchParams.set('subscriptionId', params.subscriptionId);

      const qs = searchParams.toString();
      const url = `/admin/subscription-lifecycle-events${qs ? `?${qs}` : ''}`;
      return apiClient.get<AdminLifecycleEventListResponse>(url);
    },
    staleTime: 30 * 1000,
  });
}

/** Fetch lifecycle event stats (counts by status and event type) */
export function useLifecycleEventStats() {
  return useQuery({
    queryKey: lifecycleEventKeys.stats(),
    queryFn: async () => {
      return apiClient.get<LifecycleEventStatsResponse>(
        '/admin/subscription-lifecycle-events/stats',
      );
    },
    staleTime: 30 * 1000,
  });
}

// ─── Mutations ──────────────────────────────────────────

/** Retry a single failed/cancelled lifecycle event */
export function useRetryLifecycleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.post(`/admin/subscription-lifecycle-events/${id}/retry`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lifecycleEventKeys.all });
    },
  });
}

/** Cancel a pending lifecycle event */
export function useCancelLifecycleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.post(`/admin/subscription-lifecycle-events/${id}/cancel`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lifecycleEventKeys.all });
    },
  });
}

/** Bulk retry all failed lifecycle events */
export function useBulkRetryLifecycleEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventType?: string) => {
      return apiClient.post('/admin/subscription-lifecycle-events/bulk-retry', {
        ...(eventType && { eventType }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lifecycleEventKeys.all });
    },
  });
}
