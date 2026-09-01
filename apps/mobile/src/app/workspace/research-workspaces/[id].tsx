import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useResearchWorkspace,
  useResearchQueries,
  useAskResearchQuery,
  useDeleteResearchWorkspace,
} from '../../../features/research-workspaces/hooks/use-research-workspaces';
import type { ResearchQueryListItem } from '../../../features/research-workspaces/types';

export default function ResearchWorkspaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workspaceId = id ?? '';
  const {
    data: wsResp,
    isLoading: wsLoading,
    error: wsError,
  } = useResearchWorkspace(workspaceId, !!id);
  const { data: queriesResp, isLoading: queriesLoading } =
    useResearchQueries(workspaceId, !!id);
  const askQuery = useAskResearchQuery(workspaceId);
  const deleteWorkspace = useDeleteResearchWorkspace();

  const [queryText, setQueryText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  // (`queriesResp` below keeps its envelope: that route sends `meta`.)
  const workspace = wsResp;
  const queries = queriesResp?.data ?? [];

  const handleDelete = useCallback(() => {
    if (!workspaceId) return;
    Alert.alert(
      'Delete Workspace',
      'Are you sure? All queries will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteWorkspace.mutate(workspaceId, {
              onSuccess: () => router.back(),
            }),
        },
      ],
    );
  }, [workspaceId, deleteWorkspace]);

  const handleAsk = useCallback(async () => {
    const trimmed = queryText.trim();
    if (!trimmed || askQuery.isPending) return;

    setQueryText('');
    try {
      await askQuery.mutateAsync({ query: trimmed });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 300);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to submit query',
      );
    }
  }, [queryText, askQuery]);

  if (wsLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Research Workspace' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (wsError || !workspace) {
    return (
      <>
        <Stack.Screen options={{ title: 'Research Workspace' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load workspace</Text>
          <Text style={styles.errorText}>
            {wsError instanceof Error
              ? wsError.message
              : 'Workspace not found'}
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const renderQueryItem = useCallback(
    ({ item }: { item: ResearchQueryListItem }) => (
      <QueryBubble item={item} />
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: ResearchQueryListItem) => item.id,
    [],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: workspace.title,
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={22} color="#dc2626" />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Query history */}
        {queriesLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : queries.length === 0 ? (
          <View style={styles.emptyChat}>
            <View style={styles.emptyChatIcon}>
              <Ionicons name="flask-outline" size={32} color="#1a56db" />
            </View>
            <Text style={styles.emptyChatTitle}>{workspace.title}</Text>
            {workspace.description && (
              <Text style={styles.emptyChatDescription}>
                {workspace.description}
              </Text>
            )}
            <Text style={styles.emptyChatHint}>
              Ask a question to start your research
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={queries}
            renderItem={renderQueryItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.chatContent}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.queryInput}
            value={queryText}
            onChangeText={setQueryText}
            placeholder="Ask a legal research question..."
            placeholderTextColor="#9ca3af"
            multiline
            maxLength={2000}
            editable={!askQuery.isPending}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!queryText.trim() || askQuery.isPending) &&
                styles.sendButtonDisabled,
            ]}
            onPress={handleAsk}
            disabled={!queryText.trim() || askQuery.isPending}
          >
            {askQuery.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function QueryBubble({ item }: { item: ResearchQueryListItem }) {
  const isLoading = !item.responseJson;
  const hasError = item.responseJson?.error;

  return (
    <View style={styles.queryGroup}>
      {/* User query bubble */}
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{item.query}</Text>
        <Text style={styles.bubbleTime}>
          {new Date(item.createdAt).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>

      {/* AI response */}
      {isLoading ? (
        <View style={styles.aiBubble}>
          <ActivityIndicator size="small" color="#1a56db" />
          <Text style={styles.aiLoadingText}>Researching...</Text>
        </View>
      ) : hasError ? (
        <View style={[styles.aiBubble, styles.aiErrorBubble]}>
          <Ionicons name="warning-outline" size={16} color="#991b1b" />
          <Text style={styles.aiErrorText}>
            {item.responseJson?.answer ?? 'Failed to generate response'}
          </Text>
        </View>
      ) : (
        <View style={styles.aiBubble}>
          <Text style={styles.aiBubbleText}>
            {item.responseJson?.answer}
          </Text>

          {/* Citations */}
          {item.citationsJson.length > 0 && (
            <View style={styles.citationsRow}>
              {item.citationsJson.slice(0, 5).map((c, i) => (
                <View key={i} style={styles.citationBadge}>
                  <Text
                    style={styles.citationBadgeText}
                    numberOfLines={1}
                  >
                    {c.text}
                  </Text>
                </View>
              ))}
              {item.citationsJson.length > 5 && (
                <Text style={styles.moreCitations}>
                  +{item.citationsJson.length - 5} more
                </Text>
              )}
            </View>
          )}

          {/* Follow-up suggestions */}
          {item.responseJson?.followUpSuggestions &&
            item.responseJson.followUpSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                <Text style={styles.suggestionsLabel}>Follow-up:</Text>
                {item.responseJson.followUpSuggestions.map((s, i) => (
                  <Text key={i} style={styles.suggestionText}>
                    {'\u2022'} {s}
                  </Text>
                ))}
              </View>
            )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  backButtonText: { fontSize: 14, fontWeight: '500', color: '#374151' },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyChatIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyChatTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  emptyChatDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
  },
  emptyChatHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 16,
  },

  chatContent: { padding: 12, gap: 4 },

  queryGroup: { marginBottom: 12 },

  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1a56db',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    padding: 12,
    maxWidth: '85%',
    marginBottom: 4,
  },
  userBubbleText: {
    fontSize: 14,
    color: '#fff',
    lineHeight: 20,
  },
  bubbleTime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: 12,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  aiErrorBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  aiLoadingText: {
    fontSize: 13,
    color: '#1a56db',
    marginLeft: 8,
  },
  aiBubbleText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
  },
  aiErrorText: {
    fontSize: 13,
    color: '#991b1b',
    flex: 1,
  },

  citationsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  citationBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 150,
  },
  citationBadgeText: { fontSize: 10, color: '#3730a3' },
  moreCitations: { fontSize: 10, color: '#6b7280', alignSelf: 'center' },

  suggestionsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  suggestionsLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 12,
    color: '#1a56db',
    lineHeight: 17,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 8,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  queryInput: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    maxHeight: 120,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
});
