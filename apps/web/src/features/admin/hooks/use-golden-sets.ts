'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { GoldenSetEntry, GoldenSetStats, EvaluationRun } from '../types';

// ---- Queries ----

export function useGoldenSets(params?: {
  type?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'golden-sets', params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.type) qp['type'] = params.type;
      if (params?.status) qp['status'] = params.status;
      if (params?.page) qp['page'] = String(params.page);
      if (params?.limit) qp['limit'] = String(params.limit);
      const res = await apiClient.get<{
        entries: GoldenSetEntry[];
        total: number;
        page: number;
        limit: number;
      }>('/admin/golden-sets', { params: qp });
      return res;
    },
  });
}

export function useGoldenSetStats() {
  return useQuery({
    queryKey: ['admin', 'golden-sets', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<GoldenSetStats>('/admin/golden-sets/stats');
      return res;
    },
  });
}

export function useGoldenSetEntry(id: string) {
  return useQuery({
    queryKey: ['admin', 'golden-sets', id],
    queryFn: async () => {
      const res = await apiClient.get<GoldenSetEntry>(`/admin/golden-sets/${id}`);
      return res;
    },
    enabled: !!id,
  });
}

export function useEvaluationRuns(type?: string) {
  return useQuery({
    queryKey: ['admin', 'golden-sets', 'evaluations', type],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (type) qp['type'] = type;
      const res = await apiClient.get<EvaluationRun[]>('/admin/golden-sets/evaluations', {
        params: qp,
      });
      return res;
    },
  });
}

// ---- Mutations ----

export function useApproveGoldenSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const res = await apiClient.post<GoldenSetEntry>(
        `/admin/golden-sets/${id}/approve`,
        notes ? { notes } : {},
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useRejectGoldenSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await apiClient.post<GoldenSetEntry>(
        `/admin/golden-sets/${id}/reject`,
        { notes },
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useBulkApproveGoldenSets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiClient.post<{ approved: number }>(
        '/admin/golden-sets/bulk-approve',
        { ids },
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useDeleteGoldenSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/golden-sets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useGenerateDraftDigests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (count?: number) => {
      const res = await apiClient.post<{ created: number }>(
        '/admin/golden-sets/generate/digests',
        count ? { count } : {},
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useGenerateDraftClassifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (count?: number) => {
      const res = await apiClient.post<{ created: number }>(
        '/admin/golden-sets/generate/classifications',
        count ? { count } : {},
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}

export function useSampleMcqGoldenSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (count?: number) => {
      const res = await apiClient.post<{ created: number }>(
        '/admin/golden-sets/generate/mcq-sample',
        count ? { count } : {},
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'golden-sets'] });
    },
  });
}
