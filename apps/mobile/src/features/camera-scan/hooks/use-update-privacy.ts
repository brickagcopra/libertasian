import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { PrivacyLevel } from '../types';

interface UpdatePrivacyResponse {
  success: boolean;
  data: {
    id: string;
    privacyLevel: PrivacyLevel;
  };
}

export function useUpdatePrivacy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      uploadId,
      privacyLevel,
    }: {
      uploadId: string;
      privacyLevel: PrivacyLevel;
    }) =>
      apiClient.patch<UpdatePrivacyResponse>(`/uploads/${uploadId}/privacy`, {
        privacyLevel,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['upload-detail', variables.uploadId],
      });
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });
}
