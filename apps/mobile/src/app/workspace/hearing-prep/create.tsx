import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGenerateHearingPrep } from '../../../features/hearing-prep/hooks/use-hearing-prep';
import { useSearch } from '../../../features/search/hooks/use-search';
import type { SearchResultItem } from '../../../features/search/types';

interface SelectedDocument {
  id: string;
  title: string;
  citationText: string | null;
}

export default function CreateHearingPrepScreen() {
  const generatePrep = useGenerateHearingPrep();
  const [topic, setTopic] = useState('');
  const [issue, setIssue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<SelectedDocument[]>([]);

  const { data: searchResults, isLoading: isSearching } = useSearch(
    { query: searchQuery, limit: 10 },
    searchQuery.trim().length >= 3,
  );

  const canSubmit = topic.trim().length > 0 && !generatePrep.isPending;

  const handleAddDocument = useCallback(
    (item: SearchResultItem) => {
      if (selectedDocs.length >= 10) {
        Alert.alert('Limit Reached', 'You can include up to 10 documents.');
        return;
      }
      if (selectedDocs.some((d) => d.id === item.id)) return;
      setSelectedDocs((prev) => [
        ...prev,
        { id: item.id, title: item.title, citationText: item.citationText },
      ]);
      setSearchQuery('');
    },
    [selectedDocs],
  );

  const handleRemoveDocument = useCallback((id: string) => {
    setSelectedDocs((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const result = await generatePrep.mutateAsync({
        topic: topic.trim(),
        issue: issue.trim() || undefined,
        documentIds:
          selectedDocs.length > 0
            ? selectedDocs.map((d) => d.id)
            : undefined,
      });
      if (result.data?.id) {
        router.replace(`/workspace/hearing-prep/${result.data.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error
          ? err.message
          : 'Failed to generate hearing prep',
      );
    }
  };

  const searchItems = searchResults?.items ?? [];
  const showSearchResults =
    searchQuery.trim().length >= 3 && (isSearching || searchItems.length > 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Hearing Prep',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSubmit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.submitText,
                  !canSubmit && styles.submitTextDisabled,
                ]}
              >
                {generatePrep.isPending ? 'Generating...' : 'Generate'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Topic */}
          <View style={styles.field}>
            <Text style={styles.label}>Hearing Topic *</Text>
            <TextInput
              style={styles.textInput}
              value={topic}
              onChangeText={setTopic}
              placeholder="e.g., Constructive Dismissal — Reyes v. ABC Corp"
              placeholderTextColor="#9ca3af"
              editable={!generatePrep.isPending}
            />
          </View>

          {/* Issue */}
          <View style={styles.field}>
            <Text style={styles.label}>Legal Issue (Optional)</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={issue}
              onChangeText={setIssue}
              placeholder="e.g., Whether the transfer of the employee constitutes constructive dismissal"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={!generatePrep.isPending}
            />
          </View>

          {/* Document Search */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Reference Documents ({selectedDocs.length}/10) — Optional
            </Text>
            <View style={styles.searchInputRow}>
              <Ionicons
                name="search-outline"
                size={18}
                color="#9ca3af"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search cases by title, G.R. No., or keyword..."
                placeholderTextColor="#9ca3af"
                editable={!generatePrep.isPending}
              />
            </View>

            {/* Search Results Dropdown */}
            {showSearchResults && (
              <View style={styles.searchResults}>
                {isSearching ? (
                  <View style={styles.searchLoading}>
                    <ActivityIndicator size="small" color="#1a56db" />
                    <Text style={styles.searchLoadingText}>Searching...</Text>
                  </View>
                ) : (
                  searchItems
                    .filter((r) => !selectedDocs.some((d) => d.id === r.id))
                    .slice(0, 6)
                    .map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.searchResultItem}
                        onPress={() => handleAddDocument(item)}
                      >
                        <View style={styles.searchResultContent}>
                          <Text
                            style={styles.searchResultTitle}
                            numberOfLines={2}
                          >
                            {item.title}
                          </Text>
                          {item.citationText && (
                            <Text
                              style={styles.searchResultCitation}
                              numberOfLines={1}
                            >
                              {item.citationText}
                            </Text>
                          )}
                        </View>
                        <Ionicons
                          name="add-circle-outline"
                          size={20}
                          color="#1a56db"
                        />
                      </TouchableOpacity>
                    ))
                )}
                {!isSearching && searchItems.length === 0 && (
                  <Text style={styles.noResults}>
                    No documents found. Try different keywords.
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Selected Documents */}
          {selectedDocs.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.label}>Selected Documents</Text>
              {selectedDocs.map((doc) => (
                <View key={doc.id} style={styles.selectedDoc}>
                  <View style={styles.selectedDocContent}>
                    <Text style={styles.selectedDocTitle} numberOfLines={2}>
                      {doc.title}
                    </Text>
                    {doc.citationText && (
                      <Text
                        style={styles.selectedDocCitation}
                        numberOfLines={1}
                      >
                        {doc.citationText}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveDocument(doc.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color="#dc2626"
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Info */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              The AI will prepare a comprehensive hearing pack including relevant
              cases, statutory provisions, key arguments, counter-arguments, and
              suggested questions. Generation may take up to 90 seconds.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollView: { flex: 1 },
  content: { padding: 16, gap: 20 },

  submitText: { fontSize: 16, fontWeight: '600', color: '#1a56db' },
  submitTextDisabled: { color: '#9ca3af' },

  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151' },

  textInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    fontSize: 14,
    color: '#111827',
  },
  textArea: {
    minHeight: 80,
  },

  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchIcon: { marginLeft: 12 },
  searchInput: {
    flex: 1,
    padding: 12,
    fontSize: 14,
    color: '#111827',
  },

  searchResults: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  searchLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  searchLoadingText: { fontSize: 13, color: '#6b7280' },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  searchResultContent: { flex: 1 },
  searchResultTitle: { fontSize: 13, fontWeight: '500', color: '#111827' },
  searchResultCitation: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  noResults: {
    fontSize: 13,
    color: '#9ca3af',
    padding: 12,
    textAlign: 'center',
  },

  selectedDoc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    gap: 8,
  },
  selectedDocContent: { flex: 1 },
  selectedDocTitle: { fontSize: 13, fontWeight: '500', color: '#1e40af' },
  selectedDocCitation: { fontSize: 11, color: '#3b82f6', marginTop: 2 },

  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 12, color: '#1e40af', lineHeight: 18 },
});
