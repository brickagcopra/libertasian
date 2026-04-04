import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { OcrResultsResponse } from '../types';

export function useOcrResults(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['ocr-results', uploadId],
    queryFn: () =>
      apiClient.get<OcrResultsResponse>(`/uploads/${uploadId}/ocr`),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.ocrStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 4000;
    },
    select: (res) => res.data,
  });
}
