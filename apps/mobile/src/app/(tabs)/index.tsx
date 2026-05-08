import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearch } from '../../features/search/hooks/use-search';
import { useSearchHistory } from '../../features/search/hooks/use-search-history';
import {
  useRecentlyViewed,
  type RecentlyViewedItem,
} from '../../features/documents/hooks/use-recently-viewed';
import { useBarSubjects } from '../../features/study/hooks/use-bar-subjects';
import { useGenerateDigest } from '../../features/digests/hooks/use-digests';
import { SearchTabBar } from '../../features/search/components/search-tabs';
import { AiSummaryResults } from '../../features/search/components/ai-summary-results';
import { DigestsResults } from '../../features/search/components/digests-results';
import type { SearchFilters, SearchResultItem, SearchTab } from '../../features/search/types';

const DOCUMENT_TYPES = [
  'case_decision',
  'statute',
  'executive_order',
  'administrative_order',
  'circular',
  'resolution',
] as const;

const COURTS = [
  'SUPREME_COURT',
  'COURT_OF_APPEALS',
  'SANDIGANBAYAN',
  'CTA',
] as const;

function SearchResultCard({
  item,
  onGenerateDigest,
}: {
  item: SearchResultItem;
  onGenerateDigest: (id: string) => void;
}) {
  const highlight =
    item.highlights?.find((h) => h.fragments.length > 0)?.fragments[0] ?? null;

  return (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={() => router.push(`/reader/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.resultHeader}>
        <View style={styles.badges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.documentType.replace(/_/g, ' ')}
            </Text>
          </View>
          {item.isOfficial ? (
            <View style={styles.officialBadge}>
              <Text style={styles.officialBadgeText}>Official</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => onGenerateDigest(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.digestIconButton}
        >
          <Ionicons name="document-text-outline" size={18} color="#1a56db" />
        </TouchableOpacity>
      </View>

      <Text style={styles.resultTitle} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={styles.resultMeta}>
        {item.grNo ? (
          <Text style={styles.metaText}>{item.grNo}</Text>
        ) : null}
        {item.court ? (
          <Text style={styles.metaText}>{item.court}</Text>
        ) : null}
        {item.decisionDate ? (
          <Text style={styles.metaText}>
            {new Date(item.decisionDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        ) : null}
        {item.ponente ? (
          <Text style={styles.metaText}>J. {item.ponente}</Text>
        ) : null}
      </View>

      {highlight ? (
        <Text style={styles.snippet} numberOfLines={3}>
          {highlight.replace(/<\/?mark>/g, '')}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const [searchText, setSearchText] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<SearchTab>('fulltext');

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterDocType, setFilterDocType] = useState('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterGrNo, setFilterGrNo] = useState('');
  const [filterPonente, setFilterPonente] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterBarSubject, setFilterBarSubject] = useState('');

  // Search history & recently viewed
  const { history, addEntry: addHistory, removeEntry: removeHistory, clearHistory } =
    useSearchHistory();
  const { recentlyViewed } = useRecentlyViewed();

  // Bar subjects for filter
  const { data: barSubjects } = useBarSubjects();

  // Digest generation from search results
  const generateDigest = useGenerateDigest();

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterDocType) count++;
    if (filterCourt) count++;
    if (filterGrNo.trim()) count++;
    if (filterPonente.trim()) count++;
    if (filterDateFrom.trim()) count++;
    if (filterDateTo.trim()) count++;
    if (filterBarSubject) count++;
    return count;
  }, [filterDocType, filterCourt, filterGrNo, filterPonente, filterDateFrom, filterDateTo, filterBarSubject]);

  const filters: SearchFilters = {
    query: submittedQuery,
    page,
    limit: 20,
    publishedOnly: true,
    ...(filterDocType ? { documentType: filterDocType } : {}),
    ...(filterCourt ? { court: filterCourt } : {}),
    ...(filterGrNo.trim() ? { grNo: filterGrNo.trim() } : {}),
    ...(filterPonente.trim() ? { ponente: filterPonente.trim() } : {}),
    ...(filterDateFrom.trim() ? { dateFrom: filterDateFrom.trim() } : {}),
    ...(filterDateTo.trim() ? { dateTo: filterDateTo.trim() } : {}),
    ...(filterBarSubject ? { barSubjectCode: filterBarSubject } : {}),
  };

  const { data, isLoading, isFetching, refetch } = useSearch(
    filters,
    submittedQuery.length > 0,
  );

  const handleSearch = useCallback(() => {
    const trimmed = searchText.trim();
    if (trimmed.length === 0) return;
    setPage(0);
    setSubmittedQuery(trimmed);
    addHistory(trimmed);
  }, [searchText, addHistory]);

  const handleHistoryTap = useCallback(
    (query: string) => {
      setSearchText(query);
      setPage(0);
      setSubmittedQuery(query);
      addHistory(query);
    },
    [addHistory],
  );

  const clearAllFilters = useCallback(() => {
    setFilterDocType('');
    setFilterCourt('');
    setFilterGrNo('');
    setFilterPonente('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterBarSubject('');
  }, []);

  const handleGenerateDigestFromSearch = useCallback(
    (documentId: string) => {
      Alert.alert(
        'Generate Digest',
        'Generate an AI case digest for this document?',
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
                const digestId =
                  result && typeof result === 'object' && 'data' in result
                    ? (result as { data: { id: string } }).data.id
                    : undefined;
                Alert.alert('Success', 'Digest generated successfully.', [
                  {
                    text: 'View Digest',
                    onPress: () => {
                      if (digestId) {
                        router.push(`/digest/${digestId}`);
                      }
                    },
                  },
                  { text: 'OK' },
                ]);
              } catch {
                Alert.alert(
                  'Error',
                  'Failed to generate digest. Check your subscription and quota.',
                );
              }
            },
          },
        ],
      );
    },
    [generateDigest],
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchResultItem }) => (
      <SearchResultCard
        item={item}
        onGenerateDigest={handleGenerateDigestFromSearch}
      />
    ),
    [handleGenerateDigestFromSearch],
  );

  const keyExtractor = useCallback((item: SearchResultItem) => item.id, []);

  const hasResults = data && data.data.length > 0;
  const showEmpty = submittedQuery.length > 0 && !isLoading && !hasResults;

  const documentIds = useMemo(() => {
    if (!data?.data || data.data.length === 0) return null;
    return data.data.map((item) => item.id);
  }, [data?.data]);

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons
            name="search"
            size={18}
            color="#9ca3af"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search cases, statutes, doctrines..."
            placeholderTextColor="#9ca3af"
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchText.length > 0 ? (
            <TouchableOpacity
              onPress={() => {
                setSearchText('');
                setSubmittedQuery('');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter Toggle */}
        <TouchableOpacity
          style={styles.filterToggle}
          onPress={() => setShowFilters((v) => !v)}
          activeOpacity={0.8}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={activeFilterCount > 0 ? '#fff' : '#6b7280'}
          />
          {activeFilterCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.searchButton}
          onPress={handleSearch}
          activeOpacity={0.8}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Panel */}
      {showFilters ? (
        <View style={styles.filterPanel}>
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Document Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {DOCUMENT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.chip,
                      filterDocType === type ? styles.chipActive : null,
                    ]}
                    onPress={() =>
                      setFilterDocType((prev) => (prev === type ? '' : type))
                    }
                  >
                    <Text
                      style={[
                        styles.chipText,
                        filterDocType === type ? styles.chipTextActive : null,
                      ]}
                    >
                      {type.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Court</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {COURTS.map((court) => (
                  <TouchableOpacity
                    key={court}
                    style={[
                      styles.chip,
                      filterCourt === court ? styles.chipActive : null,
                    ]}
                    onPress={() =>
                      setFilterCourt((prev) => (prev === court ? '' : court))
                    }
                  >
                    <Text
                      style={[
                        styles.chipText,
                        filterCourt === court ? styles.chipTextActive : null,
                      ]}
                    >
                      {court.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {barSubjects && barSubjects.length > 0 ? (
            <View style={styles.filterSection}>
              <Text style={styles.filterLabel}>Bar Subject</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {barSubjects.map((subj) => (
                    <TouchableOpacity
                      key={subj.code}
                      style={[
                        styles.chip,
                        filterBarSubject === subj.code ? styles.chipActive : null,
                      ]}
                      onPress={() =>
                        setFilterBarSubject((prev) =>
                          prev === subj.code ? '' : subj.code,
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.chipText,
                          filterBarSubject === subj.code ? styles.chipTextActive : null,
                        ]}
                      >
                        {subj.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.filterRow}>
            <View style={styles.filterFieldHalf}>
              <Text style={styles.filterLabel}>G.R. No.</Text>
              <TextInput
                style={styles.filterInput}
                value={filterGrNo}
                onChangeText={setFilterGrNo}
                placeholder="e.g. 123456"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.filterFieldHalf}>
              <Text style={styles.filterLabel}>Ponente</Text>
              <TextInput
                style={styles.filterInput}
                value={filterPonente}
                onChangeText={setFilterPonente}
                placeholder="e.g. Leonen"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.filterRow}>
            <View style={styles.filterFieldHalf}>
              <Text style={styles.filterLabel}>Date From</Text>
              <TextInput
                style={styles.filterInput}
                value={filterDateFrom}
                onChangeText={setFilterDateFrom}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.filterFieldHalf}>
              <Text style={styles.filterLabel}>Date To</Text>
              <TextInput
                style={styles.filterInput}
                value={filterDateTo}
                onChangeText={setFilterDateTo}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
          </View>

          {activeFilterCount > 0 ? (
            <TouchableOpacity
              style={styles.clearFiltersButton}
              onPress={clearAllFilters}
            >
              <Text style={styles.clearFiltersText}>Clear Filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Content */}
      {submittedQuery.length === 0 ? (
        <ScrollView
          style={styles.emptyScrollView}
          contentContainerStyle={styles.emptyScrollContent}
        >
          {/* Search History */}
          {history.length > 0 ? (
            <View style={styles.historySection}>
              <View style={styles.historySectionHeader}>
                <Text style={styles.historySectionTitle}>Recent Searches</Text>
                <TouchableOpacity onPress={clearHistory}>
                  <Text style={styles.historyClearText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {history.map((query) => (
                <TouchableOpacity
                  key={query}
                  style={styles.historyItem}
                  onPress={() => handleHistoryTap(query)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={16} color="#9ca3af" />
                  <Text style={styles.historyItemText} numberOfLines={1}>
                    {query}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeHistory(query)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color="#d1d5db" />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {/* Recently Viewed */}
          {recentlyViewed.length > 0 ? (
            <View style={styles.historySection}>
              <View style={styles.historySectionHeader}>
                <Text style={styles.historySectionTitle}>Recently Viewed</Text>
              </View>
              {recentlyViewed.map((doc: RecentlyViewedItem) => (
                <TouchableOpacity
                  key={`${doc.id}-${doc.viewedAt}`}
                  style={styles.recentDocItem}
                  onPress={() => router.push(`/reader/${doc.id}`)}
                  activeOpacity={0.7}
                >
                  <View style={styles.recentDocTypeBadge}>
                    <Text style={styles.recentDocTypeBadgeText}>
                      {(doc.documentType ?? 'document').replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text style={styles.recentDocTitle} numberOfLines={2}>
                    {doc.shortTitle ?? doc.title}
                  </Text>
                  {doc.grNo ? (
                    <Text style={styles.recentDocMeta}>{doc.grNo}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {/* Browse All Documents Link */}
          <TouchableOpacity
            style={styles.browseAllCard}
            onPress={() => router.push('/documents/')}
            activeOpacity={0.7}
          >
            <Ionicons name="library-outline" size={20} color="#1a56db" />
            <View style={styles.browseAllContent}>
              <Text style={styles.browseAllTitle}>Browse All Documents</Text>
              <Text style={styles.browseAllDesc}>
                Explore the full legal document corpus
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
          </TouchableOpacity>

          {/* Default empty state */}
          {history.length === 0 && recentlyViewed.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>Legal Research</Text>
              <Text style={styles.emptyText}>
                Search across Philippine cases, statutes, rules, and issuances
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : showEmpty ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No results found</Text>
          <Text style={styles.emptyText}>
            Try adjusting your search terms or broadening your query
          </Text>
        </View>
      ) : (
        <>
          {/* Tabbed results */}
          <SearchTabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            resultCount={data?.meta.total}
            documentIds={documentIds}
          />

          {activeTab === 'fulltext' ? (
            <>
              <View style={styles.resultsMeta}>
                <Text style={styles.resultsCount}>
                  {data?.meta.total ?? 0} result{(data?.meta.total ?? 0) !== 1 ? 's' : ''}
                </Text>
              </View>
              <FlatList
                data={data?.data ?? []}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl
                    refreshing={isFetching && !isLoading}
                    onRefresh={() => refetch()}
                    colors={['#1a56db']}
                  />
                }
                ListFooterComponent={
                  data?.meta.hasNext ? (
                    <View style={styles.paginationRow}>
                      <TouchableOpacity
                        style={styles.pageButton}
                        onPress={() => setPage((p) => p + 1)}
                        disabled={isFetching}
                      >
                        <Text style={styles.pageButtonText}>Load More</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
              />
            </>
          ) : activeTab === 'ai-summary' ? (
            <AiSummaryResults query={submittedQuery || null} />
          ) : activeTab === 'digests' ? (
            <DigestsResults documentIds={documentIds} />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 10,
  },
  filterToggle: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  searchButton: {
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Filter Panel
  filterPanel: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 10,
  },
  filterSection: { gap: 6 },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', gap: 6, paddingRight: 12 },
  chip: {
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: '#1a56db' },
  chipText: { fontSize: 12, color: '#374151', fontWeight: '500', textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  filterRow: { flexDirection: 'row', gap: 10 },
  filterFieldHalf: { flex: 1, gap: 4 },
  filterInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  clearFiltersButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  clearFiltersText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },

  // Search History & Recently Viewed
  emptyScrollView: { flex: 1 },
  emptyScrollContent: { paddingBottom: 32 },
  historySection: {
    backgroundColor: '#fff',
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 14,
  },
  historySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historySectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  historyClearText: { fontSize: 12, color: '#1a56db', fontWeight: '600' },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  historyItemText: { flex: 1, fontSize: 14, color: '#374151' },

  // Recently Viewed
  recentDocItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  recentDocTypeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  recentDocTypeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  recentDocTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 20,
  },
  recentDocMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  // Results
  resultsMeta: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f3f4f6',
  },
  resultsCount: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  listContent: { padding: 12, gap: 10 },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  digestIconButton: {
    padding: 4,
    borderRadius: 4,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badges: { flexDirection: 'row', gap: 6 },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  officialBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  officialBadgeText: { fontSize: 11, fontWeight: '600', color: '#059669' },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  resultMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  metaText: { fontSize: 12, color: '#6b7280' },
  snippet: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    minHeight: 300,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: '#6b7280' },
  browseAllCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  browseAllContent: { flex: 1 },
  browseAllTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },
  browseAllDesc: {
    fontSize: 11,
    color: '#3b82f6',
    marginTop: 1,
  },
  paginationRow: { alignItems: 'center', paddingVertical: 16 },
  pageButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  pageButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
