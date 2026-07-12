'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ScanListResponse,
  ScanDetailResponse,
  OcrResultsResponse,
  GenerateDigestResponse,
  ProcessingStatus,
} from '../types';

interface UseScansParams {
  processingStatus?: ProcessingStatus;
  cursor?: string;
  limit?: number;
  /**
   * Server-side upload type filter. Defaults to 'camera_scan' for backward
   * compatibility; pass 'all' to list every upload type (camera scans and
   * document uploads).
   */
  uploadType?: 'camera_scan' | 'document' | 'all';
}

export function useScans(params?: UseScansParams) {
  return useQuery({
    queryKey: ['scans', params],
    queryFn: async () => {
      const uploadType = params?.uploadType ?? 'camera_scan';
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (uploadType !== 'all') queryParams['uploadType'] = uploadType;
      if (params?.processingStatus) queryParams['processingStatus'] = params.processingStatus;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<ScanListResponse>('/uploads', { params: queryParams });
    },
  });
}

export function useScanDetail(scanId: string | null) {
  return useQuery({
    queryKey: ['scan-detail', scanId],
    queryFn: () => apiClient.get<ScanDetailResponse>(`/uploads/${scanId}`),
    enabled: !!scanId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.processingStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 5000;
    },
  });
}

export function useOcrResults(scanId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['ocr-results', scanId],
    queryFn: () => apiClient.get<OcrResultsResponse>(`/uploads/${scanId}/ocr`),
    enabled: enabled && !!scanId,
  });
}

export function useGenerateDigestFromScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { uploadId: string; digestType?: string }) =>
      apiClient.post<GenerateDigestResponse>(`/uploads/${params.uploadId}/generate-digest`, {
        digestType: params.digestType,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['scan-detail', variables.uploadId] });
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}

export function useDeleteScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scanId: string) => apiClient.delete(`/uploads/${scanId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}
