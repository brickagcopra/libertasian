import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type ListRenderItem,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { useDeepResearchAccess } from '@/features/deep-research/access';
import { Composer } from '@/features/deep-research/components/composer';
import {
  HistoryRow,
  HistorySkeleton,
  makeHistoryStyles,
} from '@/features/deep-research/components/history-row';
import {
  useDeepResearchRuns,
  useDeleteDeepResearchRun,
} from '@/features/deep-research/hooks/use-deep-research';
import { runHref } from '@/features/deep-research/navigation';
import type { DeepResearchRunListItem } from '@/features/deep-research/types';

const SKELETON_KEYS = ['s1', 's2', 's3'] as const;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    content: { padding: 16, paddingBottom: 48 },
    skeletonItem: { marginBottom: 10 },
    historyTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.inkFaint,
      marginTop: 22,
      marginBottom: 10,
    },
    empty: { fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.inkSoft, textAlign: 'center', padding: 16 },
    error: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#b91c1c', textAlign: 'center', padding: 16 },
    footer: { paddingVertical: 16 },
  });
}

function Separator() {
  return <View style={separatorStyle.gap} />;
}
const separatorStyle = StyleSheet.create({ gap: { height: 10 } });

function ResearchHome() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const historyStyles = useMemo(() => makeHistoryStyles(theme), [theme]);
  const params = useLocalSearchParams<{ q?: string }>();
  const prefill = typeof params.q === 'string' ? params.q : undefined;

  const access = useDeepResearchAccess();
  const runs = useDeepResearchRuns();
  const deleteRun = useDeleteDeepResearchRun();

  const openRun = useCallback((id: string) => router.push(runHref(id)), []);

  const confirmDelete = useCallback(
    (item: DeepResearchRunListItem) => {
      Alert.alert('Delete this run?', 'It will be removed from your history.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteRun.mutate(item.id) },
      ]);
    },
    [deleteRun],
  );

  const renderItem = useCallback<ListRenderItem<DeepResearchRunListItem>>(
    ({ item }) => (
      <HistoryRow item={item} styles={historyStyles} onOpen={openRun} onDelete={confirmDelete} />
    ),
    [historyStyles, openRun, confirmDelete],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = runs;
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const header = (
    <View>
      <Composer access={access} {...(prefill ? { initialQuestion: prefill } : {})} />
      <Text style={styles.historyTitle}>History</Text>
      {runs.isLoading ? (
        <View>
          {SKELETON_KEYS.map((k) => (
            <View key={k} style={styles.skeletonItem}>
              <HistorySkeleton styles={historyStyles} />
            </View>
          ))}
        </View>
      ) : null}
      {runs.isError ? <Text style={styles.error}>History could not be loaded.</Text> : null}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={runs.data ?? []}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListEmptyComponent={
        runs.isLoading || runs.isError ? null : (
          <Text style={styles.empty}>Your research runs will appear here.</Text>
        )
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : null
      }
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      keyboardShouldPersistTaps="handled"
      testID="deep-research-history"
    />
  );
}

export default function ResearchIndexRoute() {
  return (
    <SurfaceGuard surface="workspace" entryPoint="deepResearch">
      <ResearchHome />
    </SurfaceGuard>
  );
}
