import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { OcrResultsResponse } from '../types';

/**
 * `GET /uploads/:id/ocr` returns a bare `{ success, data }` envelope, which
 * `apiClient` already strips — so the generic names the UNWRAPPED payload and
 * there is no second `.data`. See `use-upload-status.ts` for why the double
 * unwrap also broke the poll-termination check, not just the returned value.
 */
export function useOcrResults(uploadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['ocr-results', uploadId],
    queryFn: () =>
      apiClient.get<OcrResultsResponse['data']>(`/uploads/${uploadId}/ocr`),
    enabled: enabled && !!uploadId,
    refetchInterval: (query) => {
      const status = query.state.data?.ocrStatus;
      if (status === 'completed' || status === 'failed') return false;
      return 4000;
    },
  });
}
