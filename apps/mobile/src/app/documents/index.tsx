import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Fab } from '../../components/ui/Fab';
import { LibraryScreen } from '../../components/screens/LibraryScreen';
import { useDocuments } from '../../features/documents/hooks/use-documents';
import { useNetworkState } from '../../hooks/use-network-state';
import { useTheme } from '../../providers/theme-provider';
import type {
  LibraryItem,
  LibrarySection,
} from '../../components/screens/LibraryScreen';
import type { DocumentFilters, DocumentListItem } from '../../features/documents/types';
import type { PhotoTone } from '../../lib/design-tokens';

const FILTER_LABELS = ['All', 'Cases', 'Statutes', 'Issuances', 'Resolutions'] as const;
type FilterLabel = (typeof FILTER_LABELS)[number];

function chipToDocType(label: FilterLabel): string | undefined {
  switch (label) {
    case 'Cases':
      return 'supreme_court_decision';
    case 'Statutes':
      return 'republic_act';
    case 'Issuances':
      return 'executive_order';
    case 'Resolutions':
      return 'resolution';
    default:
      return undefined;
  }
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
  const { theme } = useTheme();
  const [activeFilter, setActiveFilter] = useState<FilterLabel>('All');
  const { isConnected } = useNetworkState();

  const filters: DocumentFilters = useMemo(() => {
    const docType = chipToDocType(activeFilter);
    return {
      ...(docType ? { documentType: docType } : {}),
      limit: 24,
    };
  }, [activeFilter]);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useDocuments(filters);

  const allDocuments = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  const sections = useMemo<LibrarySection[]>(() => {
    if (allDocuments.length === 0) return [];
    // Bucket by documentType so the section view groups intuitively, capped
    // to keep ScrollView responsive without infinite scroll wiring this PR.
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
            paddingTop: 50,
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
        onSearchPress={() => router.push('/(tabs)/search')}
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
        onPressFilter={() => {
          // Phase 2 stub — advanced filters land in Phase 3 modal.
        }}
        onTabPress={(id) => {
          if (id === 'home') router.push('/(tabs)');
          else if (id === 'search') router.push('/(tabs)/search');
          else if (id === 'me') router.push('/settings');
        }}
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
    </View>
  );
}
