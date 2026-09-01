import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { FeedMediaStatus, FeedMediaProcessingStatus } from '@libertasian/types';

/**
 * The UNWRAPPED payloads. `POST /feed/media/upload` and
 * `GET /feed/media/:id/status` both return a bare `{ success, data }` envelope,
 * which `apiClient` (and `uploadMultipart`) already strip — so these describe
 * what the caller actually receives, not the wire envelope.
 */
interface UploadResult {
  mediaId: string;
  processingStatus: FeedMediaProcessingStatus;
}

interface UploadParams {
  uri: string;
  fileName: string;
  mimeType: string;
  onProgress?: (percent: number) => void;
}

export function useUploadFeedMedia() {
  return useMutation({
    mutationFn: async (params: UploadParams) => {
      const formData = new FormData();
      formData.append('file', {
        uri: params.uri,
        name: params.fileName,
        type: params.mimeType,
      } as unknown as Blob);

      return apiClient.uploadMultipart<UploadResult>('/feed/media/upload', formData, {
        onProgress: params.onProgress,
      });
    },
  });
}

export function useFeedMediaStatus(mediaId: string | null) {
  return useQuery({
    queryKey: ['feed-media-status', mediaId],
    queryFn: () =>
      apiClient.get<FeedMediaStatus>(`/feed/media/${mediaId}/status`),
    enabled: !!mediaId,
    refetchInterval: (query) => {
      // NO second `.data`. This poll previously compared `undefined` against
      // 'ready'/'failed'/'quarantined' and so never terminated: every
      // create-post screen with an attached image hit the API every 2s until
      // it unmounted.
      const status = query.state.data?.processingStatus;
      if (status === 'ready' || status === 'failed' || status === 'quarantined') {
        return false;
      }
      return 2000;
    },
  });
}

export function useDeleteFeedMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mediaId: string) =>
      apiClient.delete(`/feed/media/${mediaId}`),
    onSuccess: (_data, mediaId) => {
      queryClient.invalidateQueries({ queryKey: ['feed-media-status', mediaId] });
    },
  });
}
