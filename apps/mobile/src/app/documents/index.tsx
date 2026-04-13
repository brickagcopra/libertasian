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
} from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDocuments } from '../../features/documents/hooks/use-documents';
import { useBarSubjects } from '../../features/study/hooks/use-bar-subjects';
import { useNetworkState } from '../../hooks/use-network-state';
import type { DocumentListItem, DocumentFilters } from '../../features/documents/types';

const DOCUMENT_TYPES = [
  'supreme_court_decision',
  'republic_act',
  'executive_order',
  'presidential_decree',
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

function DocumentCard({ item }: { item: DocumentListItem }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/reader/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.documentType.replace(/_/g, ' ')}
            </Text>
          </View>
          {item.hasDigest ? (
            <View style={styles.digestBadge}>
              <Text style={styles.digestBadgeText}>Has Digest</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={styles.cardMeta}>
        {item.court ? (
          <Text style={styles.metaText}>
            {item.court.replace(/_/g, ' ')}
          </Text>
        ) : null}
        {item.citationText ? (
          <Text style={styles.metaText}>{item.citationText}</Text>
        ) : item.grNo ? (
          <Text style={styles.metaText}>{item.grNo}</Text>
        ) : null}
        {item.promulgationDate ? (
          <Text style={styles.metaText}>
            {new Date(item.promulgationDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.sectionCount}>
          {item.sectionCount} section{item.sectionCount !== 1 ? 's' : ''}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function DocumentBrowserScreen() {
  const [searchText, setSearchText] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [filterDocType, setFilterDocType] = useState('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterBarSubject, setFilterBarSubject] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { isConnected } = useNetworkState();
  const { data: barSubjects } = useBarSubjects();

  const filters: DocumentFilters = useMemo(
    () => ({
      ...(appliedQuery.trim() ? { query: appliedQuery.trim() } : {}),
      ...(filterDocType ? { documentType: filterDocType } : {}),
      ...(filterCourt ? { court: filterCourt } : {}),
      ...(filterBarSubject ? { barSubjectCode: filterBarSubject } : {}),
      limit: 20,
    }),
    [appliedQuery, filterDocType, filterCourt, filterBarSubject],
  );

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useDocuments(filters);

  const allDocuments = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.meta.total;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterDocType) count++;
    if (filterCourt) count++;
    if (filterBarSubject) count++;
    return count;
  }, [filterDocType, filterCourt, filterBarSubject]);

  const handleSearch = useCallback(() => {
    setAppliedQuery(searchText.trim());
  }, [searchText]);

  const clearAllFilters = useCallback(() => {
    setFilterDocType('');
    setFilterCourt('');
    setFilterBarSubject('');
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: DocumentListItem }) => <DocumentCard item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: DocumentListItem) => item.id, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Legal Documents',
          headerBackTitle: 'Back',
        }}
      />
      <View style={styles.container}>
        {/* Offline Banner */}
        {!isConnected ? (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#92400e" />
            <Text style={styles.offlineBannerText}>
              Offline — showing cached results
            </Text>
          </View>
        ) : null}

        {/* Search + Filter Bar */}
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
              placeholder="Search by title or citation..."
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
                  setAppliedQuery('');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            style={[
              styles.filterToggle,
              activeFilterCount > 0 && styles.filterToggleActive,
            ]}
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
                          filterBarSubject === subj.code
                            ? styles.chipActive
                            : null,
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
                            filterBarSubject === subj.code
                              ? styles.chipTextActive
                              : null,
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

        {/* Header count */}
        <View style={styles.resultsMeta}>
          <Text style={styles.resultsCount}>
            {totalCount !== undefined
              ? `${totalCount} document${totalCount !== 1 ? 's' : ''}`
              : allDocuments.length > 0
                ? `${allDocuments.length} document${allDocuments.length !== 1 ? 's' : ''} loaded`
                : 'Legal Documents'}
          </Text>
        </View>

        {/* Document List */}
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
            <Text style={styles.loadingText}>Loading documents...</Text>
          </View>
        ) : allDocuments.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="library-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No documents found</Text>
            <Text style={styles.emptyText}>
              {appliedQuery || activeFilterCount > 0
                ? 'Try adjusting your search or filters'
                : 'The legal document corpus is being populated'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={allDocuments}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetching && !isLoading && !isFetchingNextPage}
                onRefresh={() => refetch()}
                colors={['#1a56db']}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color="#1a56db" />
                  <Text style={styles.footerLoaderText}>Loading more...</Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },

  // Offline banner
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  offlineBannerText: {
    fontSize: 12,
    color: '#92400e',
    fontWeight: '500',
  },

  // Search bar
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
  filterToggleActive: {
    backgroundColor: '#1a56db',
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#ef4444',
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

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
  chipText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  chipTextActive: { color: '#fff' },
  clearFiltersButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  clearFiltersText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },

  // Results header
  resultsMeta: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f3f4f6',
  },
  resultsCount: { fontSize: 13, color: '#6b7280', fontWeight: '500' },

  // List
  listContent: { padding: 12, gap: 10 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  digestBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  digestBadgeText: { fontSize: 11, fontWeight: '600', color: '#059669' },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  metaText: { fontSize: 12, color: '#6b7280' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 8,
  },
  sectionCount: { fontSize: 12, color: '#9ca3af' },

  // States
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: '#6b7280' },
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
  footerLoader: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  footerLoaderText: { fontSize: 12, color: '#6b7280' },
});
