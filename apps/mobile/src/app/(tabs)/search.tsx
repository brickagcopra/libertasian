import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFreemiumSurfaces } from '@/features/entitlements/use-freemium-surfaces';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import {
  SearchScreen,
  type SearchResult,
} from '@/components/screens/SearchScreen';
import {
  DEFAULT_SEARCH_FILTER_LABEL,
  SEARCH_FILTER_LABELS,
  documentTypeFilter,
  kindFor,
  kindLabelFor,
} from '@/features/search/document-types';
import { legalDocumentIdOf } from '@/features/search/document-id';
import { useSearch } from '@/features/search/hooks/use-search';
import { useSearchHistory } from '@/features/search/hooks/use-search-history';
import { useRecentlyViewed } from '@/features/documents/hooks/use-recently-viewed';
import { useGenerateDigest } from '@/features/digests/hooks/use-digests';
import { SearchTabBar } from '@/features/search/components/search-tabs';
import { AiSummaryResults } from '@/features/search/components/ai-summary-results';
import { DigestsResults } from '@/features/search/components/digests-results';
import { useTheme } from '@/providers/theme-provider';
import type { PhotoTone } from '@/lib/design-tokens';
import type {
  SearchFilters,
  SearchResultItem,
  SearchTab,
} from '@/features/search/types';

const TONES: PhotoTone[] = ['warm', 'cool', 'sage', 'plum', 'sand', 'lime', 'ink'];

function toneFor(index: number): PhotoTone {
  return TONES[index % TONES.length] ?? 'warm';
}

function toResult(item: SearchResultItem, index: number): SearchResult {
  const subtitle = item.source.citation_text
    ?? item.source.gr_no
    ?? item.source.document_type.replace(/_/g, ' ');
  return {
    // Document id, not the OpenSearch `_id` — see `legalDocumentIdOf`. This id
    // drives the /reader push and the digest-generation call.
    id: legalDocumentIdOf(item),
    kind: kindFor(item.source.document_type),
    kindLabel: kindLabelFor(item.source.document_type),
    title: item.source.short_title ?? item.source.title,
    subtitle,
    tone: toneFor(index),
  };
}

export default function SearchRoute() {
  const navigate = useTabBarNav();
  const { theme } = useTheme();
  const surfaces = useFreemiumSurfaces();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>(
    DEFAULT_SEARCH_FILTER_LABEL,
  );
  const [searchTab, setSearchTab] = useState<SearchTab>('fulltext');

  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory();
  const { recentlyViewed } = useRecentlyViewed();
  const generateDigest = useGenerateDigest();

  const filters = useMemo<SearchFilters>(
    () => ({
      query: submittedQuery,
      ...documentTypeFilter(activeFilter),
      limit: 20,
    }),
    [submittedQuery, activeFilter],
  );

  const { data } = useSearch(filters, submittedQuery.trim().length > 0);

  const items = data?.data ?? [];
  const results = useMemo<SearchResult[]>(() => items.map(toResult), [items]);

  // Track query history once a real result set is back.
  useEffect(() => {
    if (submittedQuery.trim() && data) addEntry(submittedQuery);
  }, [submittedQuery, data, addEntry]);

  const handleGenerateDigest = (documentId: string) => {
    // Unreachable by tapping — the action below is not rendered without the
    // surface. Kept so the confirm-Alert can never offer an account an action
    // it cannot perform, whatever calls it.
    if (!surfaces.digestGeneration) return;
    Alert.alert(
      'Generate digest',
      'Generate an AI case digest for this document? This uses your digest quota.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            try {
              const result = await generateDigest.mutateAsync({
                legalDocumentId: documentId,
                digestType: 'case_digest',
              });
              // `POST /digests/generate` returns a bare { success, data }
              // envelope, already stripped by `apiClient` — the result IS the
              // digest. The old `'data' in result` probe was never true.
              const digestId = result?.id;
              if (digestId) router.push(`/digest/${digestId}`);
            } catch {
              Alert.alert('Error', 'Failed to generate digest. Please try again.');
            }
          },
        },
      ],
    );
  };

  // Omitted, not disabled: free digestsPerMonth is 0, so this sparkle 402s on
  // every tap. `undefined` rather than a null-returning function so
  // SearchScreen lays the row out with no action slot at all.
  const renderResultAction = !surfaces.digestGeneration
    ? undefined
    : (id: string) => (
        <Pressable
          onPress={() => handleGenerateDigest(id)}
          hitSlop={8}
          accessibilityLabel="Generate digest"
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles" size={14} color={theme.accent} />
        </Pressable>
      );

  // SearchTabBar slot — tabs only meaningful once a query is submitted.
  const tabBarSlot = submittedQuery.trim() ? (
    <SearchTabBar
      activeTab={searchTab}
      onTabChange={setSearchTab}
      resultCount={items.length}
      query={submittedQuery}
    />
  ) : null;

  // Replace results list when on a non-fulltext tab.
  let customResults: React.ReactNode = null;
  if (submittedQuery.trim() && searchTab === 'ai-summary') {
    customResults = <AiSummaryResults query={submittedQuery} />;
  } else if (submittedQuery.trim() && searchTab === 'digests') {
    customResults = <DigestsResults query={submittedQuery} />;
  }

  // Empty-query slots: recent searches + recently viewed.
  const historySlot = history.length > 0 ? (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text
          style={{
            fontFamily: 'Inter_700Bold',
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: theme.accent,
          }}
        >
          Recent searches
        </Text>
        <Pressable onPress={clearHistory} hitSlop={8}>
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: theme.inkSoft }}>
            Clear
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {history.map((q) => (
          <Pressable
            key={q}
            onPress={() => {
              setQuery(q);
              setSubmittedQuery(q);
            }}
            onLongPress={() => removeEntry(q)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Ionicons name="time-outline" size={13} color={theme.inkFaint} />
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                fontSize: 13,
                color: theme.ink,
                maxWidth: 200,
              }}
              numberOfLines={1}
            >
              {q}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const recentlyViewedSlot = recentlyViewed.length > 0 ? (
    <View>
      <Text
        style={{
          fontFamily: 'Inter_700Bold',
          fontSize: 11,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.accent,
          marginBottom: 8,
        }}
      >
        Recently viewed
      </Text>
      <View style={{ gap: 8 }}>
        {recentlyViewed.slice(0, 6).map((doc) => (
          <Pressable
            key={doc.id}
            onPress={() => router.push(`/reader/${doc.id}`)}
            style={{
              backgroundColor: theme.surface,
              borderColor: theme.line,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text
              style={{ fontFamily: theme.serif, fontSize: 15, letterSpacing: -0.2, color: theme.ink }}
              numberOfLines={1}
            >
              {doc.shortTitle ?? doc.title}
            </Text>
            {doc.grNo ? (
              <Text style={{ marginTop: 2, fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
                {doc.grNo}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  return (
    <SearchScreen
      query={query}
      onChangeQuery={setQuery}
      onSubmitQuery={() => setSubmittedQuery(query)}
      onClearQuery={() => {
        setQuery('');
        setSubmittedQuery('');
      }}
      hideCancel
      filters={SEARCH_FILTER_LABELS}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
      results={results}
      onPressResult={(id) => router.push(`/reader/${id}`)}
      renderResultAction={renderResultAction}
      belowFiltersSlot={tabBarSlot}
      customResults={customResults}
      historySlot={historySlot}
      recentlyViewedSlot={recentlyViewedSlot}
      activeTab="search"
      onTabPress={navigate}
    />
  );
}
