import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { UploadStatusResponse, UploadDetailResponse } from '../types';

export function useUploadStatus(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['upload-status', uploadId],
    queryFn: () =>
      apiClient.get<UploadStatusResponse>(`/uploads/${uploadId}/status`),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.processingStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 3000;
    },
    select: (res) => res.data,
  });
}

export function useUploadDetail(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['upload-detail', uploadId],
    queryFn: () =>
      apiClient.get<UploadDetailResponse>(`/uploads/${uploadId}`),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.processingStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 5000;
    },
    select: (res) => res.data,
  });
}
