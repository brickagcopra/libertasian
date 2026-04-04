import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { GenerateDigestResponse } from '../types';

interface GenerateDigestParams {
  uploadId: string;
  digestType?: 'case_digest' | 'statute_summary' | 'reviewer_note' | 'study_digest';
}

export function useGenerateDigest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uploadId, digestType }: GenerateDigestParams) => {
      return apiClient.post<GenerateDigestResponse>(
        `/uploads/${uploadId}/generate-digest`,
        digestType ? { digestType } : undefined,
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['upload-detail', variables.uploadId] });
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
