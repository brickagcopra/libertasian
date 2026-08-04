import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Fab } from '@/components/ui/Fab';
import { LibraryScreen } from '@/components/screens/LibraryScreen';
import { useDocuments } from '@/features/documents/hooks/use-documents';
import { useBarSubjects } from '@/features/study/hooks/use-bar-subjects';
import { useNetworkState } from '@/hooks/use-network-state';
import { useTheme } from '@/providers/theme-provider';
import type {
  LibraryItem,
  LibrarySection,
} from '@/components/screens/LibraryScreen';
import type { DocumentFilters, DocumentListItem } from '@/features/documents/types';
import type { PhotoTone } from '@/lib/design-tokens';

// Chip labels match the API documentType enum on
// apps/api/src/modules/search/dto/search-query.dto.ts:24:
// ['case','statute','codal','article','outline']. The previous chips
// "Issuances" / "Resolutions" mapped to documentType values that the DB
// has never stored (every Library filter returned empty on prod).
const FILTER_LABELS = ['All', 'Cases', 'Statutes', 'Codals', 'Articles', 'Outlines'] as const;
type FilterLabel = (typeof FILTER_LABELS)[number];

const COURTS = ['SUPREME_COURT', 'COURT_OF_APPEALS', 'SANDIGANBAYAN', 'CTA'] as const;

function chipToDocType(label: FilterLabel): string | undefined {
  switch (label) {
    case 'Cases':
      return 'case';
    case 'Statutes':
      return 'statute';
    case 'Codals':
      return 'codal';
    case 'Articles':
      return 'article';
    case 'Outlines':
      return 'outline';
    default:
      return undefined;
  }
}

function courtLabel(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const TONES: PhotoTone[] = ['warm', 'cool', 'sage', 'plum', 'sand', 'lime', 'ink'];

function toneFor(index: number): PhotoTone {
  return TONES[index % TONES.length] ?? 'warm';
}

function formatDocType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildItems(docs: DocumentListItem[]): LibraryItem[] {
  return docs.map((doc, i) => ({
    id: doc.id,
    title: doc.title,
    subtitle: doc.citationText ?? doc.grNo ?? formatDocType(doc.documentType),
    tone: toneFor(i),
  }));
}

export default function DocumentsRoute() {
  const navigate = useTabBarNav();
  const { theme } = useTheme();
  const [activeFilter, setActiveFilter] = useState<FilterLabel>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [filterCourt, setFilterCourt] = useState<string>('');
  const [filterBarSubject, setFilterBarSubject] = useState<string>('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { isConnected } = useNetworkState();

  const filters: DocumentFilters = useMemo(() => {
    const docType = chipToDocType(activeFilter);
    return {
      ...(docType ? { documentType: docType } : {}),
      ...(filterCourt ? { court: filterCourt } : {}),
      ...(filterBarSubject ? { barSubjectCode: filterBarSubject } : {}),
      ...(submittedQuery.trim() ? { query: submittedQuery.trim() } : {}),
      limit: 24,
    };
  }, [activeFilter, filterCourt, filterBarSubject, submittedQuery]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useDocuments(filters);

  const { data: barSubjects } = useBarSubjects();

  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (filterCourt) count++;
    if (filterBarSubject) count++;
    return count;
  }, [filterCourt, filterBarSubject]);

  const allDocuments = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  const sections = useMemo<LibrarySection[]>(() => {
    if (allDocuments.length === 0) return [];
    const groups = new Map<string, DocumentListItem[]>();
    for (const doc of allDocuments) {
      const arr = groups.get(doc.documentType) ?? [];
      arr.push(doc);
      groups.set(doc.documentType, arr);
    }
    return Array.from(groups.entries()).map(([type, docs]) => ({
      id: type,
      title: formatDocType(type),
      items: buildItems(docs.slice(0, 8)),
    }));
  }, [allDocuments]);

  const handlePressItem = useCallback((_sectionId: string, itemId: string) => {
    router.push(`/reader/${itemId}`);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleClearAdvanced = useCallback(() => {
    setFilterCourt('');
    setFilterBarSubject('');
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {!isConnected ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: theme.accentSoft,
            paddingTop: 8,
            paddingBottom: 8,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: theme.ink }}>
            Offline — showing cached results
          </Text>
        </View>
      ) : null}
      <LibraryScreen
        filterCategories={FILTER_LABELS as unknown as string[]}
        activeFilter={activeFilter}
        onFilterChange={(f) => setActiveFilter(f as FilterLabel)}
        searchPlaceholder="Search 12,000+ cases & statutes"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={() => setSubmittedQuery(searchQuery)}
        onSearchClear={() => {
          setSearchQuery('');
          setSubmittedQuery('');
        }}
        sections={
          sections.length > 0
            ? sections
            : isLoading
            ? []
            : [
                {
                  id: 'empty',
                  title: 'No documents',
                  items: [],
                },
              ]
        }
        onPressItem={handlePressItem}
        onPressFilter={() => setFilterSheetOpen(true)}
        filterCount={advancedFilterCount}
        refreshing={isRefetching}
        onRefresh={handleRefresh}
        contentTopPadding={12}
        onTabPress={navigate}
      />
      {hasNextPage ? (
        <Pressable
          onPress={handleLoadMore}
          disabled={isFetchingNextPage}
          style={{
            position: 'absolute',
            bottom: 90,
            left: 18,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.line,
          }}
        >
          {isFetchingNextPage ? (
            <ActivityIndicator size="small" color={theme.ink} />
          ) : (
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: theme.ink }}>
              Load more
            </Text>
          )}
        </Pressable>
      ) : null}
      <Fab onPress={() => router.push('/(tabs)/scan')} accessibilityLabel="Scan a document" />

      {/* Advanced filter sheet — Court + Bar Subject. */}
      <Modal
        visible={filterSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterSheetOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.bg,
              padding: 22,
              paddingBottom: 36,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '80%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: theme.serif, fontSize: 26, letterSpacing: -0.6, color: theme.ink }}>
                Filters
              </Text>
              {advancedFilterCount > 0 ? (
                <Pressable onPress={handleClearAdvanced}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.accent }}>
                    Clear all
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false}>
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  fontSize: 11,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: theme.accent,
                  marginTop: 6,
                  marginBottom: 8,
                }}
              >
                Court
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {COURTS.map((c) => (
                  <Chip
                    key={c}
                    label={courtLabel(c)}
                    selected={filterCourt === c}
                    onPress={() => setFilterCourt(filterCourt === c ? '' : c)}
                  />
                ))}
              </View>

              {barSubjects && barSubjects.length > 0 ? (
                <>
                  <Text
                    style={{
                      fontFamily: 'Inter_700Bold',
                      fontSize: 11,
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      color: theme.accent,
                      marginTop: 22,
                      marginBottom: 8,
                    }}
                  >
                    Bar subject
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {barSubjects.map((s) => (
                      <Chip
                        key={s.code}
                        label={s.name}
                        selected={filterBarSubject === s.code}
                        onPress={() =>
                          setFilterBarSubject(filterBarSubject === s.code ? '' : s.code)
                        }
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </ScrollView>

            <View style={{ height: 14 }} />
            <Button
              label="Apply filters"
              variant="primary"
              full
              onPress={() => setFilterSheetOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
