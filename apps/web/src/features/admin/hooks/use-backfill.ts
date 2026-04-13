'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BackfillBatch } from '../types';

export function useBackfillBatches(params?: {
  status?: string;
  sourceId?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'backfill', params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.status) qp['status'] = params.status;
      if (params?.sourceId) qp['sourceId'] = params.sourceId;
      if (params?.page) qp['page'] = String(params.page);
      const res = await apiClient.get<{
        success: boolean;
        data: BackfillBatch[];
        meta: { total: number };
      }>('/admin/backfill/batches', { params: qp });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useBackfillBatch(id: string) {
  return useQuery({
    queryKey: ['admin', 'backfill', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      sourceId: string;
      name: string;
      description?: string;
      yearStart: number;
      yearEnd: number;
      monthStart?: number;
      monthEnd?: number;
      budgetCeilingUsd: number;
      adminNotes?: string;
      startImmediately?: boolean;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        '/admin/backfill/batches',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useStartBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/start`,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function usePauseBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/pause`,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useResumeBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/resume`,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useHaltBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/halt`,
        { reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useExtendBackfillBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      newCeilingUsd,
      reason,
    }: {
      id: string;
      newCeilingUsd: number;
      reason: string;
    }) => {
      const res = await apiClient.patch<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/budget`,
        { newCeilingUsd, reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useKillInflight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
      confirmName,
    }: {
      id: string;
      reason: string;
      confirmName: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: BackfillBatch }>(
        `/admin/backfill/batches/${id}/kill-inflight`,
        { reason, confirmName },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}

export function useDeleteBackfillBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/backfill/batches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backfill'] });
    },
  });
}
