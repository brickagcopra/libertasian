import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { FeedMediaStatus, FeedMediaProcessingStatus } from '@libertasian/types';

interface UploadResponse {
  success: boolean;
  data: {
    mediaId: string;
    processingStatus: FeedMediaProcessingStatus;
  };
}

interface MediaStatusResponse {
  success: boolean;
  data: FeedMediaStatus;
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

      return apiClient.uploadMultipart<UploadResponse>('/feed/media/upload', formData, {
        onProgress: params.onProgress,
      });
    },
  });
}

export function useFeedMediaStatus(mediaId: string | null) {
  return useQuery({
    queryKey: ['feed-media-status', mediaId],
    queryFn: () =>
      apiClient.get<MediaStatusResponse>(`/feed/media/${mediaId}/status`),
    enabled: !!mediaId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.processingStatus;
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
