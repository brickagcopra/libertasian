import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { SearchScreen, type SearchResult, type SearchResultKind } from '@/components/screens/SearchScreen';
import { useSearch } from '@/features/search/hooks/use-search';
import type { PhotoTone } from '@/lib/design-tokens';
import type { SearchResultItem } from '@/features/search/types';

const FILTERS = ['All', 'Cases', 'Articles', 'Statutes', 'Outlines'] as const;
type FilterLabel = (typeof FILTERS)[number];

const TONES: PhotoTone[] = ['warm', 'cool', 'sage', 'plum', 'sand', 'lime', 'ink'];

function toneFor(index: number): PhotoTone {
  return TONES[index % TONES.length] ?? 'warm';
}

function kindFor(documentType: string): SearchResultKind {
  if (documentType === 'supreme_court_decision' || documentType === 'case_decision') return 'CASE';
  if (documentType === 'republic_act' || documentType === 'statute' || documentType === 'executive_order') return 'STATUTE';
  return 'ARTICLE';
}

function chipToDocType(label: FilterLabel): string | undefined {
  if (label === 'Cases') return 'supreme_court_decision';
  if (label === 'Statutes') return 'republic_act';
  return undefined;
}

function toResult(item: SearchResultItem, index: number): SearchResult {
  const subtitle = item.source.citation_text
    ?? item.source.gr_no
    ?? item.source.document_type.replace(/_/g, ' ');
  return {
    id: item.id,
    kind: kindFor(item.source.document_type),
    title: item.source.short_title ?? item.source.title,
    subtitle,
    tone: toneFor(index),
  };
}

export default function SearchRoute() {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterLabel>('All');

  const filters = useMemo(
    () => ({
      query,
      ...(chipToDocType(activeFilter) ? { documentType: chipToDocType(activeFilter) } : {}),
      limit: 20,
    }),
    [query, activeFilter],
  );

  const { data } = useSearch(filters, query.trim().length > 0);
  const results = useMemo<SearchResult[]>(() => {
    const items = data?.data ?? [];
    return items.map(toResult);
  }, [data]);

  return (
    <SearchScreen
      query={query}
      onChangeQuery={setQuery}
      onClearQuery={() => setQuery('')}
      filters={FILTERS as unknown as string[]}
      activeFilter={activeFilter}
      onFilterChange={(f) => setActiveFilter(f as FilterLabel)}
      results={results}
      onPressResult={(id) => router.push(`/reader/${id}`)}
      activeTab="search"
      onTabPress={(id) => {
        if (id === 'home') router.push('/(tabs)');
        else if (id === 'docs') router.push('/documents');
        else if (id === 'me') router.push('/settings');
      }}
    />
  );
}
