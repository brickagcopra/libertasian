'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { SearchDigestItem } from '../types';

/**
 * The Digests tab, backed by real search.
 *
 * It used to POST `/digests/by-documents` with the ids of the documents the
 * full-text tab happened to return — so it could only ever surface digests
 * attached to those documents, and only if the document arm matched first. A
 * digest whose doctrine says "estafa" was unreachable unless its source decision
 * also ranked for "estafa".
 *
 * Now it queries the `case_digests` corpus directly, which indexes every prose
 * field (facts, issues, ruling, doctrine, dispositive, both argument fields).
 * `documentIds` is gone from this path entirely.
 */

/** One hit as the case-digests index stores it. Snake_case: this is `_source`. */
interface CaseDigestHitSource {
  digest_id: string;
  title: string;
  legal_document_id?: string;
  digest_type: string;
  summary?: string;
  visibility: string;
  review_status: string;
  confidence_score?: number;
  created_at: string;
}

interface CaseDigestHit {
  id: string;
  score: number;
  source: CaseDigestHitSource;
  kind?: string;
}

interface FederatedSearchResponse {
  success: boolean;
  data: CaseDigestHit[];
  meta: {
    total: number;
    counts?: { documents: number; derivatives: number; digests: number };
  };
}

/**
 * Map an index hit onto the shape the result cards already render.
 *
 * `legalDocument` is null for every hit: the case-digests index carries
 * `legal_document_id` but no denormalised case caption, court or G.R. number.
 * The cards already guard on it, so the source line is simply not rendered.
 * Denormalising those fields is a mapping change (new physical index + alias
 * flip) and is deliberately not part of this PR.
 */
function toDigestItem(hit: CaseDigestHit): SearchDigestItem {
  const source = hit.source;
  return {
    id: source.digest_id,
    title: source.title,
    summary: source.summary ?? null,
    digestType: source.digest_type,
    confidenceScore: source.confidence_score ?? null,
    reviewStatus: source.review_status,
    visibility: source.visibility,
    createdAt: source.created_at,
    legalDocument: null,
  };
}

interface SearchDigestsResult {
  data: SearchDigestItem[];
  count: number;
}

export function useSearchDigests(query: string, enabled: boolean) {
  const trimmed = query.trim();

  return useQuery<SearchDigestsResult>({
    queryKey: ['search-digests', trimmed],
    queryFn: async () => {
      const response = await apiClient.post<FederatedSearchResponse>('/search', {
        query: trimmed,
        scope: 'digests',
        limit: 20,
      });
      return {
        data: (response.data ?? []).map(toDigestItem),
        // The count comes off the SAME response rather than a second
        // round-trip, so the tab badge can never disagree with the list.
        count: response.meta?.counts?.digests ?? response.meta?.total ?? 0,
      };
    },
    enabled: enabled && trimmed.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
