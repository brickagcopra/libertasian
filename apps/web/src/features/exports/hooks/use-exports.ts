'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  CreateExportRequest,
  ExportJobDetail,
  ExportJobListItem,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────

const exportKeys = {
  all: ['exports'] as const,
  detail: (id: string) => ['exports', id] as const,
};

// ─── Create Export ───────────────────────────────────────────────────────

export function useCreateExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateExportRequest) => {
      const res = await apiClient.post<{
        success: boolean;
        data: ExportJobDetail;
      }>('/exports', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportKeys.all });
    },
  });
}

// ─── Get Export (with polling) ───────────────────────────────────────────

export function useExport(id: string | null) {
  return useQuery({
    queryKey: exportKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: ExportJobDetail;
      }>(`/exports/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const job = query.state.data as ExportJobDetail | undefined;
      if (job && (job.status === 'pending' || job.status === 'processing')) {
        return 2000;
      }
      return false;
    },
  });
}

// ─── List Exports ────────────────────────────────────────────────────────

export function useExports(params?: { contentType?: string; limit?: number }) {
  return useQuery({
    queryKey: [...exportKeys.all, params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.contentType) qp['contentType'] = params.contentType;
      if (params?.limit) qp['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: ExportJobListItem[];
        nextCursor: string | null;
      }>('/exports', { params: qp });
      return res;
    },
  });
}

// ─── Download Export ─────────────────────────────────────────────────────

export function useDownloadExport() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.download(`/exports/${id}/download`);
    },
  });
}
