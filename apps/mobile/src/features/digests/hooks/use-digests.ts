import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  Digest,
  DigestFilters,
  DigestSubjectSummary,
  DigestsResponse,
} from '../types';

function buildDigestParams(
  filters: DigestFilters,
  cursor?: string,
): Record<string, string> {
  const params: Record<string, string> = {};
  const effectiveCursor = cursor ?? filters.cursor;
  if (effectiveCursor) params['cursor'] = effectiveCursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.subjectCode) params['subjectCode'] = filters.subjectCode;
  if (filters.digestType) params['digestType'] = filters.digestType;
  if (filters.reviewStatus) params['reviewStatus'] = filters.reviewStatus;
  if (filters.legalDocumentId)
    params['legalDocumentId'] = filters.legalDocumentId;
  if (filters.sourceOrigin) params['sourceOrigin'] = filters.sourceOrigin;
  if (filters.visibility) params['visibility'] = filters.visibility;
  if (filters.orderBy) params['orderBy'] = filters.orderBy;
  if (filters.orderDirection)
    params['orderDirection'] = filters.orderDirection;
  return params;
}

/**
 * Paginated digests list.
 *
 * `select` flattens the pages so callers keep reading a plain
 * `data.data` array — the screen renders one continuous list rather than
 * the first 30 rows and nothing else.
 */
export function useDigests(
  filters: DigestFilters = {},
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: ['digests', filters],
    queryFn: ({ pageParam }) =>
      apiClient.get<DigestsResponse>('/digests', {
        params: buildDigestParams(filters, pageParam),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta?.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
    select: (data) => ({
      data: data.pages.flatMap((p) => p.data),
      meta: data.pages[data.pages.length - 1]?.meta ?? { hasNext: false },
    }),
    staleTime: 2 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/** Per-subject counts for the digests browse filter. */
export function useDigestSubjects(taxonomyVersion = 'study_8') {
  return useQuery({
    queryKey: ['digests', 'subjects', taxonomyVersion],
    queryFn: () =>
      apiClient.get<DigestSubjectSummary[]>('/digests/subjects/summary', {
        params: { taxonomyVersion },
      }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDigest(id: string, enabled = true) {
  return useQuery({
    queryKey: ['digest', id],
    queryFn: () => apiClient.get<Digest>(`/digests/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGenerateDigest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { legalDocumentId: string; digestType?: string }) =>
      apiClient.post<Digest>('/digests/generate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
