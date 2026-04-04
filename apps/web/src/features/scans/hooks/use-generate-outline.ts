'use client';

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { GenerateOutlineResponse } from '../types';

interface GenerateOutlineParams {
  uploadId: string;
  outlineType?: string;
}

export function useGenerateOutlineFromScan() {
  return useMutation({
    mutationFn: ({ uploadId, ...body }: GenerateOutlineParams) =>
      apiClient.post<GenerateOutlineResponse>(
        `/uploads/${uploadId}/generate-outline`,
        body,
      ),
  });
}
