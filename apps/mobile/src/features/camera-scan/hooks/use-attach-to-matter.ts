import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { AttachToMatterResponse } from '../types';

interface AttachToMatterParams {
  uploadId: string;
  matterId: string;
  title?: string;
  role?: string;
}

export function useAttachToMatter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uploadId, ...body }: AttachToMatterParams) => {
      return apiClient.post<AttachToMatterResponse>(
        `/uploads/${uploadId}/attach-to-matter`,
        body,
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['upload-detail', variables.uploadId] });
      queryClient.invalidateQueries({ queryKey: ['matters'] });
    },
  });
}
