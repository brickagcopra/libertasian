import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '@/components/ui';
import {
  useDigests,
  useGenerateDigest,
} from '../../features/digests/hooks/use-digests';
import { useDigestTextSearch } from '../../features/digests/hooks/use-digest-text-search';
import { useBarSubjects } from '../../features/study/hooks/use-bar-subjects';
import { ApiClientError } from '../../lib/api-client';
import type {
  Digest,
  DigestFilters,
  MatchedDocument,
} from '../../features/digests/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f3f4f6', text: '#6b7280' },
  ai_generated: { bg: '#eff6ff', text: '#1d4ed8' },
  needs_human_review: { bg: '#fef3c7', text: '#92400e' },
  approved: { bg: '#ecfdf5', text: '#059669' },
  rejected: { bg: '#fef2f2', text: '#dc2626' },
};

const DIGEST_TYPES = [
  { label: 'Case Digest', value: 'case_digest' },
  { label: 'Statute Summary', value: 'statute_summary' },
  { label: 'Reviewer Note', value: 'reviewer_note' },
  { label: 'Study Digest', value: 'study_digest' },
];

const REVIEW_STATUSES = [
  { label: 'Draft', value: 'draft' },
  { label: 'AI Generated', value: 'ai_generated' },
  { label: 'Needs Review', value: 'needs_human_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

const SOURCE_ORIGINS = [
  { label: 'Editorial', value: 'editorial_corpus' },
  { label: 'User Scan', value: 'user_scan' },
  { label: 'AI Generated', value: 'ai_generated' },
];

const SORT_OPTIONS = [
  { label: 'Newest First', orderBy: 'createdAt' as const, orderDirection: 'desc' as const },
  { label: 'Oldest First', orderBy: 'createdAt' as const, orderDirection: 'asc' as const },
  { label: 'Highest Confidence', orderBy: 'confidenceScore' as const, orderDirection: 'desc' as const },
  { label: 'Lowest Confidence', orderBy: 'confidenceScore' as const, orderDirection: 'asc' as const },
];

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#9ca3af';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function DigestCard({ item }: { item: Digest }) {
  const statusStyle = STATUS_COLORS[item.reviewStatus] ?? STATUS_COLORS['draft'];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/digest/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.digestType.replace(/_/g, ' ')}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusStyle.text }]}>
              {item.reviewStatus.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>
        {item.confidenceScore !== null ? (
          <Text
            style={[
              styles.confidenceText,
              { color: getConfidenceColor(item.confidenceScore) },
            ]}
          >
            {Math.round(item.confidenceScore * 100)}%
          </Text>
        ) : null}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      {item.facts ? (
        <Text style={styles.factsPreview} numberOfLines={3}>
          {item.facts}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.sourceText}>
          {item.sourceOrigin.replace(/_/g, ' ')}
        </Text>
        <Text style={styles.dateText}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function DigestsTab() {
  const [digestType, setDigestType] = useState<string | undefined>();
  const [reviewStatus, setReviewStatus] = useState<string | undefined>();
  const [barSubjectCode, setBarSubjectCode] = useState<string | undefined>();
  const [sourceOrigin, setSourceOrigin] = useState<string | undefined>();
  const [sortIndex, setSortIndex] = useState(0);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Debounce raw input → committed query (mirrors the web digests page).
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const isSearching = searchQuery.length > 0;

  const { data: barSubjects } = useBarSubjects();

  const filters: DigestFilters = useMemo(
    () => ({
      limit: 30,
      digestType,
      reviewStatus,
      barSubjectCode,
      sourceOrigin,
      orderBy: SORT_OPTIONS[sortIndex].orderBy,
      orderDirection: SORT_OPTIONS[sortIndex].orderDirection,
    }),
    [digestType, reviewStatus, barSubjectCode, sourceOrigin, sortIndex],
  );

  const { data, isLoading, isFetching, refetch } = useDigests(filters);

  // Server-side full-text search path — activated once the user types.
  const {
    data: searchData,
    isLoading: searchLoading,
    error: searchError,
  } = useDigestTextSearch(searchQuery, isSearching);

  const generateDigest = useGenerateDigest();

  const hasActiveFilters = !!(digestType || reviewStatus || barSubjectCode || sourceOrigin);

  const clearFilters = useCallback(() => {
    setDigestType(undefined);
    setReviewStatus(undefined);
    setBarSubjectCode(undefined);
    setSourceOrigin(undefined);
  }, []);

  const toggleFilter = useCallback(
    (
      current: string | undefined,
      value: string,
      setter: (v: string | undefined) => void,
    ) => {
      setter(current === value ? undefined : value);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Digest }) => <DigestCard item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: Digest) => item.id, []);

  // Same confirm-Alert pattern as the search tab's generate flow, plus
  // explicit 402 (subscription) / 429 (quota) messaging.
  const handleGenerate = useCallback(
    (doc: MatchedDocument) => {
      Alert.alert(
        'Generate digest',
        `Generate an AI case digest for "${doc.title}"? This uses your digest quota.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Generate',
            onPress: async () => {
              try {
                const result = await generateDigest.mutateAsync({
                  legalDocumentId: doc.id,
                  digestType: 'case_digest',
                });
                const digestId =
                  result && typeof result === 'object' && 'data' in result
                    ? (result as unknown as { data: { id: string } }).data.id
                    : result?.id;
                if (digestId) router.push(`/digest/${digestId}`);
              } catch (err) {
                if (err instanceof ApiClientError && err.statusCode === 402) {
                  Alert.alert(
                    'Upgrade required',
                    'An active subscription is required to generate digests on demand.',
                  );
                  return;
                }
                if (err instanceof ApiClientError && err.statusCode === 429) {
                  Alert.alert(
                    'Quota reached',
                    'You have hit your digest generation limit. Try again later.',
                  );
                  return;
                }
                Alert.alert('Error', 'Failed to generate digest. Please try again.');
              }
            },
          },
        ],
      );
    },
    [generateDigest],
  );

  const renderMatchedDocument = useCallback(
    ({ item }: { item: MatchedDocument }) => (
      <View style={styles.matchedCard}>
        <View style={styles.matchedInfo}>
          <Text style={styles.matchedTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.grNo || item.citationText ? (
            <Text style={styles.matchedMeta} numberOfLines={1}>
              {[item.grNo, item.citationText].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[
            styles.generateButton,
            generateDigest.isPending && styles.generateButtonDisabled,
          ]}
          onPress={() => handleGenerate(item)}
          disabled={generateDigest.isPending}
          activeOpacity={0.7}
          accessibilityLabel="Generate digest"
        >
          <Ionicons name="sparkles" size={14} color="#fff" />
          <Text style={styles.generateButtonText}>Generate digest</Text>
        </TouchableOpacity>
      </View>
    ),
    [generateDigest.isPending, handleGenerate],
  );

  const matchedKeyExtractor = useCallback((item: MatchedDocument) => item.id, []);

  const subjectChips = useMemo(
    () =>
      (barSubjects ?? []).map((s) => ({
        label: s.name,
        value: s.code,
      })),
    [barSubjects],
  );

  if (isLoading && !isSearching) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  const digests = data?.data ?? [];
  const searchResults = searchData?.results ?? [];
  const matchedDocuments = searchData?.matchedDocuments ?? [];
  // REPLACE semantics: while a query is active, search results take over the
  // list entirely; clearing the box restores the filtered browse list untouched.
  const listData = isSearching ? searchResults : digests;

  const FilterBar = (
    <View style={styles.filterContainer}>
      {/* Full-text search */}
      <View style={styles.searchRow}>
        <Input
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search by title, case name, or citation..."
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search digests"
          leading={<Ionicons name="search-outline" size={18} color="#6b7280" />}
          trailing={
            searchInput.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchInput('')}
                hitSlop={8}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </TouchableOpacity>
            ) : undefined
          }
        />
      </View>

      {/* Chips + sort only apply while browsing, not while actively searching */}
      {!isSearching ? (
        <>
          {/* Sort button + Clear all */}
          <View style={styles.filterActions}>
        <TouchableOpacity
          style={styles.sortButton}
          onPress={() => setSortModalVisible(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="swap-vertical-outline" size={16} color="#374151" />
          <Text style={styles.sortButtonText}>
            {SORT_OPTIONS[sortIndex].label}
          </Text>
        </TouchableOpacity>
        {hasActiveFilters ? (
          <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
            <Text style={styles.clearAllText}>Clear all</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Digest Type chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {DIGEST_TYPES.map((t) => (
          <FilterChip
            key={t.value}
            label={t.label}
            active={digestType === t.value}
            onPress={() => toggleFilter(digestType, t.value, setDigestType)}
          />
        ))}
      </ScrollView>

      {/* Review Status chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {REVIEW_STATUSES.map((s) => (
          <FilterChip
            key={s.value}
            label={s.label}
            active={reviewStatus === s.value}
            onPress={() => toggleFilter(reviewStatus, s.value, setReviewStatus)}
          />
        ))}
      </ScrollView>

      {/* Source Origin chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {SOURCE_ORIGINS.map((o) => (
          <FilterChip
            key={o.value}
            label={o.label}
            active={sourceOrigin === o.value}
            onPress={() => toggleFilter(sourceOrigin, o.value, setSourceOrigin)}
          />
        ))}
      </ScrollView>

      {/* Bar Subject chips */}
      {subjectChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {subjectChips.map((s) => (
            <FilterChip
              key={s.value}
              label={s.label}
              active={barSubjectCode === s.value}
              onPress={() =>
                toggleFilter(barSubjectCode, s.value, setBarSubjectCode)
              }
            />
          ))}
        </ScrollView>
      ) : null}
        </>
      ) : null}
    </View>
  );

  let listBody: ReactNode;
  if (isSearching && searchLoading) {
    listBody = (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  } else if (isSearching && searchError) {
    listBody = (
      <View style={styles.emptyState}>
        <Ionicons name="alert-circle-outline" size={48} color="#fca5a5" />
        <Text style={styles.emptyTitle}>Search failed</Text>
        <Text style={styles.emptyText}>
          {searchError instanceof Error
            ? searchError.message
            : 'Please try again in a moment.'}
        </Text>
      </View>
    );
  } else if (isSearching && searchResults.length === 0 && matchedDocuments.length > 0) {
    // No digests matched, but the server found legal documents the user can
    // generate a digest from.
    listBody = (
      <FlatList
        data={matchedDocuments}
        renderItem={renderMatchedDocument}
        keyExtractor={matchedKeyExtractor}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text style={styles.matchedHeaderText}>
            {`No digests found matching "${searchQuery}" — but we found ${matchedDocuments.length} legal ${matchedDocuments.length === 1 ? 'document' : 'documents'} you can generate a digest from:`}
          </Text>
        }
      />
    );
  } else if (listData.length === 0) {
    listBody = (
      <View style={styles.emptyState}>
        <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyTitle}>No digests found</Text>
        <Text style={styles.emptyText}>
          {isSearching
            ? `No digests found matching "${searchQuery}". Try a different search term.`
            : hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Generate case digests from legal documents using AI'}
        </Text>
      </View>
    );
  } else {
    listBody = (
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          isSearching ? undefined : (
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              colors={['#1a56db']}
            />
          )
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      {FilterBar}

      {listBody}

      {/* Sort modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSortModalVisible(false)}
        >
          <View style={styles.sortSheet}>
            <Text style={styles.sortSheetTitle}>Sort By</Text>
            {SORT_OPTIONS.map((opt, idx) => (
              <TouchableOpacity
                key={opt.label}
                style={[
                  styles.sortOption,
                  idx === sortIndex && styles.sortOptionActive,
                ]}
                onPress={() => {
                  setSortIndex(idx);
                  setSortModalVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    idx === sortIndex && styles.sortOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
                {idx === sortIndex ? (
                  <Ionicons name="checkmark" size={18} color="#1a56db" />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterContainer: {
    backgroundColor: '#fff',
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
  },
  searchRow: {
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 2,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  chipRow: {
    paddingHorizontal: 12,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
  },
  chipActive: {
    backgroundColor: '#1a56db',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  chipTextActive: {
    color: '#fff',
  },
  listContent: { padding: 12, gap: 10 },
  matchedHeaderText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    marginBottom: 4,
  },
  matchedCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  matchedInfo: { flex: 1 },
  matchedTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
  },
  matchedMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  generateButtonDisabled: { opacity: 0.6 },
  generateButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
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
    alignItems: 'center',
    marginBottom: 8,
  },
  badges: { flexDirection: 'row', gap: 6, flex: 1 },
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
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  confidenceText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  factsPreview: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceText: {
    fontSize: 11,
    color: '#9ca3af',
    textTransform: 'capitalize',
  },
  dateText: { fontSize: 11, color: '#9ca3af' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sortSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  sortSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  sortOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  sortOptionActive: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  sortOptionText: {
    fontSize: 14,
    color: '#374151',
  },
  sortOptionTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
});
