import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { UploadListResponse, ProcessingStatus, UploadType } from '../types';

interface UseUploadsParams {
  uploadType?: UploadType;
  processingStatus?: ProcessingStatus;
  limit?: number;
}

export function useUploads(params: UseUploadsParams = {}) {
  const { uploadType, processingStatus, limit = 20 } = params;

  return useInfiniteQuery({
    queryKey: ['uploads', { uploadType, processingStatus }],
    queryFn: ({ pageParam }) => {
      const queryParams: Record<string, string> = {
        limit: String(limit),
      };
      if (pageParam) queryParams['cursor'] = pageParam;
      if (uploadType) queryParams['uploadType'] = uploadType;
      if (processingStatus) queryParams['processingStatus'] = processingStatus;

      return apiClient.get<UploadListResponse>('/uploads', { params: queryParams });
    },
    initialPageParam: '' as string,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    select: (data) => ({
      uploads: data.pages.flatMap((p) => p.data),
      hasNext: data.pages[data.pages.length - 1]?.meta.hasNext ?? false,
    }),
  });
}

export function useDeleteUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (uploadId: string) =>
      apiClient.delete(`/uploads/${uploadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });
}
