'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  DerivativeStatsResponse,
  DerivativeSettings,
  DerivativeJob,
  EnqueueResult,
} from '../types';

// ---- Queries ----

export function useDerivativeStats() {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<DerivativeStatsResponse>(
        '/admin/derivatives/stats',
      );
      return res;
    },
    refetchInterval: 30_000,
  });
}

export function useDerivativeSettings() {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'settings'],
    queryFn: async () => {
      const res = await apiClient.get<DerivativeSettings>(
        '/admin/derivatives/settings',
      );
      return res;
    },
  });
}

export function useDerivativeJobs(params?: {
  derivativeType?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.derivativeType) qp['derivativeType'] = params.derivativeType;
      if (params?.status) qp['status'] = params.status;
      if (params?.page) qp['page'] = String(params.page);
      if (params?.limit) qp['limit'] = String(params.limit);
      const res = await apiClient.get<{ data: DerivativeJob[]; total: number }>(
        '/admin/derivatives/jobs',
        { params: qp },
      );
      return res;
    },
  });
}

export function useDerivativeJob(id: string) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', id],
    queryFn: async () => {
      const res = await apiClient.get<DerivativeJob>(
        `/admin/derivatives/jobs/${id}`,
      );
      return res;
    },
    enabled: !!id,
  });
}

// ---- Mutations ----

export function useUpdateDerivativeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      enabled?: boolean;
      typesEnabled?: Record<string, boolean>;
    }) => {
      const res = await apiClient.patch<void>(
        '/admin/derivatives/settings',
        dto,
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}

export function useEnqueueGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: {
      derivativeType: string;
      dateFrom?: string;
      dateTo?: string;
      sourceId?: string;
      court?: string;
      subjectCode?: string;
      regenerateExisting?: boolean;
      maxCount?: number;
    }) => {
      const res = await apiClient.post<EnqueueResult>(
        '/admin/derivatives/generate',
        dto,
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}

export function useRetryDerivativeJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/admin/derivatives/jobs/${id}/retry`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}

export function useRegenerateArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ jobId: string }>(
        `/admin/derivatives/artifacts/${id}/regenerate`,
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}

export function useSoftDeleteArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/derivatives/artifacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}
