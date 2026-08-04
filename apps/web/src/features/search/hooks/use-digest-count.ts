'use client';

import { useSearchDigests } from './use-search-digests';

/**
 * The count badge on the Digests tab.
 *
 * It used to POST `/digests/by-documents/count` — a second round-trip whose
 * filter had to be kept in lockstep with the list query's by hand. It now reads
 * `meta.counts.digests` off the SAME `/search` response the list renders, which
 * TanStack Query serves from cache under the identical query key. One request,
 * and the badge cannot disagree with the list it labels.
 */
export function useDigestCount(query: string, enabled: boolean) {
  const { data, ...rest } = useSearchDigests(query, enabled);
  return { ...rest, data: data?.count };
}
