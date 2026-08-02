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
import { useGenerateComparison } from '../../../features/case-comparisons/hooks/use-case-comparisons';
import { COMPARISON_TYPE_LABELS } from '../../../features/case-comparisons/types';
import type { ComparisonType } from '../../../features/case-comparisons/types';
import { legalDocumentIdOf } from '../../../features/search/document-id';
import { useSearch } from '../../../features/search/hooks/use-search';
import type { SearchResultItem } from '../../../features/search/types';

const COMPARISON_TYPES: {
  value: ComparisonType;
  label: string;
  description: string;
}[] = [
  {
    value: 'full',
    label: 'Full Comparison',
    description: 'Compare all aspects: doctrine, facts, ruling, and reasoning',
  },
  {
    value: 'doctrine_only',
    label: 'Doctrine Only',
    description: 'Focus on legal doctrines and principles applied',
  },
  {
    value: 'facts_only',
    label: 'Facts Only',
    description: 'Compare factual circumstances across cases',
  },
  {
    value: 'ruling_only',
    label: 'Ruling Only',
    description: 'Compare dispositions and outcomes',
  },
];

interface SelectedDocument {
  id: string;
  title: string;
  citationText: string | null;
}

export default function CreateComparisonScreen() {
  const generateComparison = useGenerateComparison();
  const [comparisonType, setComparisonType] =
    useState<ComparisonType>('full');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<SelectedDocument[]>([]);

  const { data: searchResults, isLoading: isSearching } = useSearch(
    { query: searchQuery, limit: 10 },
    searchQuery.trim().length >= 3,
  );

  const canSubmit =
    selectedDocs.length >= 2 &&
    selectedDocs.length <= 5 &&
    !generateComparison.isPending;

  const handleAddDocument = useCallback(
    (item: SearchResultItem) => {
      if (selectedDocs.length >= 5) {
        Alert.alert('Limit Reached', 'You can compare up to 5 documents.');
        return;
      }
      // Document id, not the OpenSearch `_id` — this is POSTed as documentIds.
      const documentId = legalDocumentIdOf(item);
      if (selectedDocs.some((d) => d.id === documentId)) return;
      setSelectedDocs((prev) => [
        ...prev,
        { id: documentId, title: item.source.title, citationText: item.source.citation_text ?? null },
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
      const result = await generateComparison.mutateAsync({
        documentIds: selectedDocs.map((d) => d.id),
        comparisonType,
      });
      if (result?.id) {
        router.replace(`/workspace/comparisons/${result.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to generate comparison',
      );
    }
  };

  const searchItems = searchResults?.data ?? [];
  const showSearchResults =
    searchQuery.trim().length >= 3 && (isSearching || searchItems.length > 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Comparison',
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
                {generateComparison.isPending ? 'Generating...' : 'Compare'}
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
          {/* Document Search */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Search Documents ({selectedDocs.length}/5)
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
                editable={!generateComparison.isPending}
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
                    .filter(
                      (r) =>
                        !selectedDocs.some((d) => d.id === legalDocumentIdOf(r)),
                    )
                    .slice(0, 6)
                    .map((item) => (
                      <TouchableOpacity
                        key={legalDocumentIdOf(item)}
                        style={styles.searchResultItem}
                        onPress={() => handleAddDocument(item)}
                      >
                        <View style={styles.searchResultContent}>
                          <Text
                            style={styles.searchResultTitle}
                            numberOfLines={2}
                          >
                            {item.source.title}
                          </Text>
                          {item.source.citation_text && (
                            <Text
                              style={styles.searchResultCitation}
                              numberOfLines={1}
                            >
                              {item.source.citation_text}
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
              {selectedDocs.length < 2 && (
                <Text style={styles.minDocsHint}>
                  Select at least 2 documents to compare
                </Text>
              )}
            </View>
          )}

          {/* Comparison Type */}
          <View style={styles.field}>
            <Text style={styles.label}>Comparison Type</Text>
            {COMPARISON_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.typeOption,
                  comparisonType === type.value && styles.typeOptionActive,
                ]}
                onPress={() => setComparisonType(type.value)}
                disabled={generateComparison.isPending}
              >
                <View style={styles.typeRadio}>
                  <View
                    style={[
                      styles.typeRadioInner,
                      comparisonType === type.value &&
                        styles.typeRadioInnerActive,
                    ]}
                  />
                </View>
                <View style={styles.typeContent}>
                  <Text
                    style={[
                      styles.typeLabel,
                      comparisonType === type.value && styles.typeLabelActive,
                    ]}
                  >
                    {type.label}
                  </Text>
                  <Text style={styles.typeDescription}>{type.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              Select 2–5 legal documents to compare. The AI will analyze
              similarities and differences across the selected dimensions.
              Generation may take up to 60 seconds.
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
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
  minDocsHint: {
    fontSize: 11,
    color: '#ea580c',
    fontStyle: 'italic',
    marginTop: 2,
  },

  typeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
  },
  typeOptionActive: {
    borderColor: '#1a56db',
    backgroundColor: '#eff6ff',
  },
  typeRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  typeRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  typeRadioInnerActive: { backgroundColor: '#1a56db' },
  typeContent: { flex: 1 },
  typeLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  typeLabelActive: { color: '#1e40af' },
  typeDescription: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    lineHeight: 16,
  },

  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 12, color: '#1e40af', lineHeight: 18 },
});
