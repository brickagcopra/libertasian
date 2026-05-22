import { useState, useEffect, useCallback } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { getCachedCodalsBySubject } from '../../../storage/sqlite';
import type { CodalListItem, CodalListMeta } from '../types';

interface CodalsResponse {
  data: CodalListItem[];
  meta: CodalListMeta;
}

export type CodalTabGroup =
  | 'constitutions'
  | 'statutes'
  | 'executive_issuances'
  | 'rules';

// Mirror of TAB_GROUP_TO_TYPES in apps/api/src/modules/study/study.service.ts.
// Used for client-side filtering when offline (server applies it online).
const TAB_GROUP_TO_TYPES: Record<CodalTabGroup, string[]> = {
  constitutions: ['constitution'],
  statutes: ['statute', 'codal', 'republic_act', 'commonwealth_act', 'batas_pambansa'],
  executive_issuances: [
    'executive_order',
    'presidential_decree',
    'proclamation',
    'administrative_order',
  ],
  rules: ['rules_of_court', 'rule'],
};

interface CodalFilters {
  subject: string;
  documentType?: string;
  tabGroup?: CodalTabGroup;
  search?: string;
  limit?: number;
}

export function useCodals(filters: CodalFilters & { cursor?: string }) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.documentType) params['documentType'] = filters.documentType;
  if (filters.tabGroup) params['tabGroup'] = filters.tabGroup;
  if (filters.search) params['search'] = filters.search;

  return useQuery({
    queryKey: ['study', 'codals', filters.subject, filters],
    queryFn: () =>
      apiClient.get<CodalsResponse>(`/study/codals/${filters.subject}`, {
        params,
      }),
    enabled: filters.subject.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useInfiniteCodals(filters: Omit<CodalFilters, 'limit'>) {
  return useInfiniteQuery({
    queryKey: ['study', 'codals', 'infinite', filters.subject, filters],
    queryFn: ({ pageParam }) => {
      const params: Record<string, string> = {};
      if (pageParam) params['cursor'] = pageParam as string;
      params['limit'] = '20';
      if (filters.documentType) params['documentType'] = filters.documentType;
      if (filters.tabGroup) params['tabGroup'] = filters.tabGroup;
      if (filters.search) params['search'] = filters.search;

      return apiClient.get<CodalsResponse>(
        `/study/codals/${filters.subject}`,
        { params },
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? lastPage.meta.nextCursor : undefined,
    enabled: filters.subject.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Returns cached codals from SQLite when the device is offline.
 * Falls back to local cache for the given subject, with optional
 * client-side filtering by documentType and search text.
 */
export function useOfflineCodals(filters: {
  subject: string;
  documentType?: string;
  tabGroup?: CodalTabGroup;
  search?: string;
  enabled: boolean;
}) {
  const [data, setData] = useState<CodalListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadCached = useCallback(async () => {
    if (!filters.enabled || !filters.subject) return;

    setIsLoading(true);
    try {
      const cached = await getCachedCodalsBySubject(filters.subject);

      let items: CodalListItem[] = cached.map((c) => ({
        id: c.id,
        title: c.title,
        shortTitle: c.shortTitle,
        documentType: c.documentType,
        citationText: c.citationText,
        promulgationDate: c.promulgationDate,
        isOfficial: c.isOfficial,
        sectionCount: c.sectionCount,
      }));

      // Client-side filtering. tabGroup overrides single documentType match
      // to mirror the server (see study.service.ts).
      if (filters.tabGroup) {
        const allowed = new Set(TAB_GROUP_TO_TYPES[filters.tabGroup]);
        items = items.filter((i) => allowed.has(i.documentType));
      } else if (filters.documentType) {
        items = items.filter((i) => i.documentType === filters.documentType);
      }

      if (filters.search) {
        const q = filters.search.toLowerCase();
        items = items.filter(
          (i) =>
            i.title.toLowerCase().includes(q) ||
            (i.citationText?.toLowerCase().includes(q) ?? false),
        );
      }

      setData(items);
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    filters.enabled,
    filters.subject,
    filters.documentType,
    filters.tabGroup,
    filters.search,
  ]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  return { data, isLoading };
}
