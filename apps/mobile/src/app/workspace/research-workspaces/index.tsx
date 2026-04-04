import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useResearchWorkspaces,
  useDeleteResearchWorkspace,
} from '../../../features/research-workspaces/hooks/use-research-workspaces';
import type { ResearchWorkspaceListItem } from '../../../features/research-workspaces/types';

function WorkspaceCard({
  item,
  onDelete,
}: {
  item: ResearchWorkspaceListItem;
  onDelete: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push(`/workspace/research-workspaces/${item.id}`)
      }
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.iconContainer}>
          <Ionicons name="flask-outline" size={18} color="#1a56db" />
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      {item.description && (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
      )}

      <View style={styles.cardFooter}>
        <View style={styles.queryCountBadge}>
          <Ionicons
            name="chatbubble-outline"
            size={11}
            color="#6b7280"
          />
          <Text style={styles.queryCountText}>
            {item.queryCount} {item.queryCount === 1 ? 'query' : 'queries'}
          </Text>
        </View>
        <Text style={styles.footerText}>
          {new Date(item.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ResearchWorkspacesListScreen() {
  const { data, isLoading, isFetching, refetch } = useResearchWorkspaces({
    limit: 30,
  });
  const deleteWorkspace = useDeleteResearchWorkspace();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete Workspace',
        'Are you sure? All queries in this workspace will be deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteWorkspace.mutate(id),
          },
        ],
      );
    },
    [deleteWorkspace],
  );

  const renderItem = useCallback(
    ({ item }: { item: ResearchWorkspaceListItem }) => (
      <WorkspaceCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback(
    (item: ResearchWorkspaceListItem) => item.id,
    [],
  );

  const workspaces = data?.data ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Research Workspaces',
          headerRight: () => (
            <TouchableOpacity
              onPress={() =>
                router.push(
                  '/workspace/research-workspaces/create' as never,
                )
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add-circle-outline" size={26} color="#1a56db" />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : workspaces.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="flask-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No research workspaces</Text>
            <Text style={styles.emptyText}>
              Create persistent AI research workspaces to explore legal topics
              with context-aware follow-up queries
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() =>
                router.push(
                  '/workspace/research-workspaces/create' as never,
                )
              }
            >
              <Text style={styles.emptyButtonText}>New Workspace</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={workspaces}
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
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { padding: 12, gap: 10 },

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
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  queryCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  queryCountText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  footerText: { fontSize: 11, color: '#9ca3af' },

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
  emptyButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
