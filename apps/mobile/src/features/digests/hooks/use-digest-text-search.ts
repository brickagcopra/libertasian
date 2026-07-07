import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { DigestTextSearchResult } from '../types';

/**
 * GET /digests/search responds with `{ success, data: {...}, meta? }`.
 * `apiClient` only unwraps the envelope when its keys are a subset of
 * `{ success, data, message }` — preview-mode responses carry a sibling
 * `meta` key, in which case the WHOLE envelope comes back un-unwrapped.
 * Callers therefore see one of two shapes; normalize both here.
 */
export type RawDigestTextSearchResponse =
  | DigestTextSearchResult
  | {
      success: boolean;
      data: DigestTextSearchResult;
      meta?: Record<string, unknown>;
      message?: string;
    };

export function normalizeDigestTextSearchResponse(
  resp: RawDigestTextSearchResponse,
): DigestTextSearchResult {
  return 'results' in resp ? resp : resp.data;
}

/**
 * Full-text digest search (title / case name / G.R. No. / citation) over
 * approved public digests. Distinct from `useSearchDigests` in
 * `features/search`, which is an unrelated /digests/by-documents batch hook.
 */
export function useDigestTextSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['digest-text-search', q],
    queryFn: async () => {
      const resp = await apiClient.get<RawDigestTextSearchResponse>(
        '/digests/search',
        { params: { q, limit: '30' } },
      );
      return normalizeDigestTextSearchResponse(resp);
    },
    enabled: enabled && q.trim().length > 0,
    retry: false,
  });
}
