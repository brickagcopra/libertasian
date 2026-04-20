'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  DerivativeStatsResponse,
  DerivativeSettings,
  DerivativeJob,
  EnqueueResult,
  JobDigestResponse,
  JobDoctrinesResponse,
  JobEssayResponse,
} from '../types';

/** Standard API response envelope from NestJS controllers */
type ApiEnvelope<T> = { success: boolean; data: T };

// ---- Queries ----

export function useDerivativeStats() {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<DerivativeStatsResponse>>(
        '/admin/derivatives/stats',
      );
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useDerivativeSettings() {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'settings'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<DerivativeSettings>>(
        '/admin/derivatives/settings',
      );
      return res.data;
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
      const res = await apiClient.get<ApiEnvelope<{ data: DerivativeJob[]; total: number }>>(
        '/admin/derivatives/jobs',
        { params: qp },
      );
      return res.data;
    },
  });
}

export function useDerivativeJob(id: string) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<DerivativeJob>>(
        `/admin/derivatives/jobs/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useJobDigest(jobId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', jobId, 'digest'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<JobDigestResponse>>(
        `/admin/derivatives/jobs/${jobId}/digest`,
      );
      return res.data;
    },
    enabled: opts?.enabled !== false && !!jobId,
  });
}

export function useJobDoctrines(jobId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', jobId, 'doctrines'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<JobDoctrinesResponse>>(
        `/admin/derivatives/jobs/${jobId}/doctrines`,
      );
      return res.data;
    },
    enabled: opts?.enabled !== false && !!jobId,
  });
}

export function useJobEssay(jobId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', jobId, 'essay'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<JobEssayResponse>>(
        `/admin/derivatives/jobs/${jobId}/essay`,
      );
      return res.data;
    },
    enabled: opts?.enabled !== false && !!jobId,
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
      const res = await apiClient.patch<ApiEnvelope<void>>(
        '/admin/derivatives/settings',
        dto,
      );
      return res.data;
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
      const res = await apiClient.post<ApiEnvelope<EnqueueResult>>(
        '/admin/derivatives/generate',
        dto,
      );
      return res.data;
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
      const res = await apiClient.post<ApiEnvelope<{ jobId: string }>>(
        `/admin/derivatives/artifacts/${id}/regenerate`,
      );
      return res.data;
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

export function useDeleteJobOutput() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      await apiClient.delete(`/admin/derivatives/jobs/${jobId}/output`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
    },
  });
}

export interface ArtifactReviewResult {
  artifactId: string;
  reviewId: string;
  newStatus: string;
  newVisibility: string;
  verdict: string;
  subjectsCopiedFromParent: number;
}

export function useReviewArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      verdict: 'approve' | 'reject' | 'needs_revision';
      notes?: string;
      truthfulnessScore?: number;
      completenessScore?: number;
      citationAccuracyScore?: number;
    }) => {
      const { id, ...body } = args;
      const res = await apiClient.post<ApiEnvelope<ArtifactReviewResult>>(
        `/admin/derivatives/artifacts/${id}/review`,
        body,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivatives'] });
      queryClient.invalidateQueries({ queryKey: ['derivatives'] });
    },
  });
}
