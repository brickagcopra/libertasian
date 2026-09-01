import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { UploadStatusResponse, UploadDetail } from '../types';

/**
 * `GET /uploads/:id/status` and `GET /uploads/:id` both return a bare
 * `{ success, data }` envelope, which `apiClient` already strips. The generics
 * below therefore name the UNWRAPPED payload, and there is no second `.data`.
 *
 * The old code read `.data` twice in two places at once, and both mattered:
 * `select` handed every consumer `undefined`, and `refetchInterval` compared
 * `undefined` against 'completed'/'failed' — so the poll never terminated and
 * these screens kept hitting the API every 3–5s for the life of the screen.
 */
export function useUploadStatus(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['upload-status', uploadId],
    queryFn: () =>
      apiClient.get<UploadStatusResponse['data']>(
        `/uploads/${uploadId}/status`,
      ),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.processingStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 3000;
    },
  });
}

export function useUploadDetail(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['upload-detail', uploadId],
    queryFn: () => apiClient.get<UploadDetail>(`/uploads/${uploadId}`),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.processingStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 5000;
    },
  });
}
