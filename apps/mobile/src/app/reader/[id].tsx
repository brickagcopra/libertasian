import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useDocument,
  useDocumentSections,
} from '../../features/documents/hooks/use-document';
import {
  useDocumentCitations,
  useRelatedDocuments,
} from '../../features/documents/hooks/use-documents';
import {
  useBookmarks,
  useCreateBookmark,
} from '../../features/bookmarks/hooks/use-bookmarks';
import { useDigests, useGenerateDigest } from '../../features/digests/hooks/use-digests';
import { useRecentlyViewed } from '../../features/documents/hooks/use-recently-viewed';
import { useOfflineCodals } from '../../features/study/hooks/use-offline-codals';
import { OfflineBadge } from '../../features/study/components/offline-badge';
import { ContentDisclaimer } from '../../features/documents/components/content-disclaimer';
import type { DocumentCitation, RelatedDocument, DocumentSection } from '../../features/documents/types';

type ContentTab = 'sections' | 'citations' | 'related';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const documentId = id ?? '';

  const { data: doc, isLoading: docLoading, error: docError } = useDocument(documentId);
  const { data: sections, isLoading: sectionsLoading } =
    useDocumentSections(documentId);

  const [activeTab, setActiveTab] = useState<ContentTab>('sections');
  const { data: citations, isLoading: citationsLoading } =
    useDocumentCitations(documentId, activeTab === 'citations');
  const { data: related, isLoading: relatedLoading } =
    useRelatedDocuments(documentId, activeTab === 'related');

  const { data: existingDigests } = useDigests({ legalDocumentId: documentId, limit: 1 });
  const hasExistingDigest =
    existingDigests?.data && existingDigests.data.length > 0;
  const existingDigestId = hasExistingDigest ? existingDigests.data[0].id : null;

  const { data: bookmarksData } = useBookmarks({ legalDocumentId: documentId });
  const createBookmark = useCreateBookmark();

  const generateDigest = useGenerateDigest();

  const [showBookmarkForm, setShowBookmarkForm] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');

  const { addEntry: addRecentlyViewed } = useRecentlyViewed();

  const { isOffline, saveForOffline, removeOffline, saving } = useOfflineCodals();

  useEffect(() => {
    if (doc) {
      addRecentlyViewed({
        id: doc.id,
        title: doc.title,
        shortTitle: doc.shortTitle ?? null,
        documentType: doc.documentType,
        grNo: doc.grNo ?? null,
        court: doc.court ?? null,
      });
    }
    // Only run when doc loads, not on every addRecentlyViewed change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  const isBookmarked =
    bookmarksData?.data && bookmarksData.data.length > 0;

  const handleBookmark = useCallback(async () => {
    if (isBookmarked) return;
    try {
      await createBookmark.mutateAsync({
        legalDocumentId: documentId,
        note: bookmarkNote.trim() || undefined,
      });
      setShowBookmarkForm(false);
      setBookmarkNote('');
    } catch {
      Alert.alert('Error', 'Failed to create bookmark.');
    }
  }, [documentId, bookmarkNote, isBookmarked, createBookmark]);

  const handleGenerateDigest = useCallback(async () => {
    Alert.alert(
      'Generate Digest',
      'Generate an AI case digest for this document? This uses your digest quota.',
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
                'Failed to generate digest. You may need a paid subscription or have exceeded your quota.',
              );
            }
          },
        },
      ],
    );
  }, [documentId, generateDigest]);

  const handleToggleOffline = useCallback(async () => {
    if (saving) return;
    if (isOffline(documentId)) {
      await removeOffline(documentId);
    } else {
      await saveForOffline(documentId, doc?.documentType ?? 'unknown');
    }
  }, [documentId, doc?.documentType, isOffline, saveForOffline, removeOffline, saving]);

  if (docLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (docError || !doc) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Document not found</Text>
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

  const sectionCount = sections?.length ?? doc._count?.sections ?? 0;
  const citationCount = doc._count?.citations ?? 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: doc.shortTitle ?? doc.citationText ?? 'Document',
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.docHeader}>
          <View style={styles.badges}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {doc.documentType.replace(/_/g, ' ')}
              </Text>
            </View>
            {doc.isOfficial ? (
              <View style={styles.officialBadge}>
                <Text style={styles.officialBadgeText}>Official</Text>
              </View>
            ) : null}
            {isOffline(documentId) ? <OfflineBadge size="small" /> : null}
          </View>

          <Text style={styles.docTitle}>{doc.title}</Text>

          <ContentDisclaimer
            contentClass={doc.isOfficial ? 'official_text' : 'community'}
            compact
          />

          <View style={styles.metaGrid}>
            {doc.grNo ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>G.R. No.</Text>
                <Text style={styles.metaValue}>{doc.grNo}</Text>
              </View>
            ) : null}
            {doc.court ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Court</Text>
                <Text style={styles.metaValue}>{doc.court}</Text>
              </View>
            ) : null}
            {doc.ponente ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Ponente</Text>
                <Text style={styles.metaValue}>J. {doc.ponente}</Text>
              </View>
            ) : null}
            {doc.decisionDate ? (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Decision Date</Text>
                <Text style={styles.metaValue}>
                  {new Date(doc.decisionDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Action Row */}
          <View style={styles.actionRow}>
            {hasExistingDigest ? (
              <TouchableOpacity
                style={styles.viewDigestButton}
                onPress={() => router.push(`/digest/${existingDigestId}`)}
              >
                <Ionicons name="document-text" size={16} color="#059669" />
                <Text style={styles.viewDigestText}>View Digest</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.generateDigestButton}
                onPress={handleGenerateDigest}
                disabled={generateDigest.isPending}
              >
                {generateDigest.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="document-text-outline" size={16} color="#fff" />
                    <Text style={styles.generateDigestText}>Generate Digest</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.offlineButton,
                isOffline(documentId) && styles.offlineButtonSaved,
              ]}
              onPress={handleToggleOffline}
              disabled={saving === documentId}
            >
              {saving === documentId ? (
                <ActivityIndicator size="small" color="#1a56db" />
              ) : (
                <>
                  <Ionicons
                    name={isOffline(documentId) ? 'cloud-done' : 'cloud-download-outline'}
                    size={16}
                    color={isOffline(documentId) ? '#059669' : '#1a56db'}
                  />
                  <Text
                    style={[
                      styles.offlineButtonText,
                      isOffline(documentId) && styles.offlineButtonTextSaved,
                    ]}
                  >
                    {isOffline(documentId) ? 'Saved Offline' : 'Save Offline'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Bookmark */}
          <View style={styles.bookmarkSection}>
            {isBookmarked ? (
              <View style={styles.bookmarkedBadge}>
                <Ionicons name="bookmark" size={16} color="#1a56db" />
                <Text style={styles.bookmarkedText}>Bookmarked</Text>
              </View>
            ) : showBookmarkForm ? (
              <View style={styles.bookmarkForm}>
                <TextInput
                  style={styles.bookmarkInput}
                  value={bookmarkNote}
                  onChangeText={setBookmarkNote}
                  placeholder="Add a note (optional)"
                  placeholderTextColor="#9ca3af"
                  multiline
                />
                <View style={styles.bookmarkActions}>
                  <TouchableOpacity
                    style={styles.bookmarkCancel}
                    onPress={() => {
                      setShowBookmarkForm(false);
                      setBookmarkNote('');
                    }}
                  >
                    <Text style={styles.bookmarkCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.bookmarkSave}
                    onPress={handleBookmark}
                    disabled={createBookmark.isPending}
                  >
                    {createBookmark.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.bookmarkSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.bookmarkButton}
                onPress={() => setShowBookmarkForm(true)}
              >
                <Ionicons name="bookmark-outline" size={16} color="#1a56db" />
                <Text style={styles.bookmarkButtonText}>Bookmark</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Content Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'sections' && styles.tabActive]}
            onPress={() => setActiveTab('sections')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'sections' && styles.tabTextActive,
              ]}
            >
              Sections{sectionCount > 0 ? ` (${sectionCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'citations' && styles.tabActive]}
            onPress={() => setActiveTab('citations')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'citations' && styles.tabTextActive,
              ]}
            >
              Citations{citationCount > 0 ? ` (${citationCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'related' && styles.tabActive]}
            onPress={() => setActiveTab('related')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'related' && styles.tabTextActive,
              ]}
            >
              Related
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'sections' ? (
            <SectionsTab sections={sections ?? []} loading={sectionsLoading} />
          ) : activeTab === 'citations' ? (
            <CitationsTab citations={citations ?? []} loading={citationsLoading} />
          ) : (
            <RelatedTab documents={related ?? []} loading={relatedLoading} />
          )}
        </View>
      </ScrollView>
    </>
  );
}

function SectionsTab({
  sections,
  loading,
}: {
  sections: DocumentSection[];
  loading: boolean;
}) {
  if (loading) {
    return <ActivityIndicator color="#1a56db" style={styles.tabLoader} />;
  }

  if (sections.length === 0) {
    return (
      <View style={styles.noContent}>
        <Ionicons name="document-outline" size={32} color="#d1d5db" />
        <Text style={styles.noContentText}>
          No sections available for this document
        </Text>
      </View>
    );
  }

  return (
    <>
      {sections.map((section) => (
        <View key={section.id} style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionLabel}>
              {section.sectionLabel ??
                section.sectionType.replace(/_/g, ' ')}
            </Text>
            {section.pageStart !== null ? (
              <Text style={styles.pageRef}>
                p.{section.pageStart}
                {section.pageEnd && section.pageEnd !== section.pageStart
                  ? `-${section.pageEnd}`
                  : ''}
              </Text>
            ) : null}
          </View>
          {section.plainText ? (
            <Text style={styles.sectionText}>{section.plainText}</Text>
          ) : (
            <Text style={styles.noSectionContentText}>
              Section content not available
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

function CitationsTab({
  citations,
  loading,
}: {
  citations: DocumentCitation[];
  loading: boolean;
}) {
  if (loading) {
    return <ActivityIndicator color="#1a56db" style={styles.tabLoader} />;
  }

  if (citations.length === 0) {
    return (
      <View style={styles.noContent}>
        <Ionicons name="link-outline" size={32} color="#d1d5db" />
        <Text style={styles.noContentText}>
          No citations found for this document
        </Text>
      </View>
    );
  }

  return (
    <>
      {citations.map((citation) => (
        <TouchableOpacity
          key={citation.id}
          style={styles.citationCard}
          onPress={() => {
            if (citation.citedDocumentId) {
              router.push(`/reader/${citation.citedDocumentId}`);
            }
          }}
          activeOpacity={citation.citedDocumentId ? 0.7 : 1}
          disabled={!citation.citedDocumentId}
        >
          <View style={styles.citationHeader}>
            <View style={styles.citationTypeBadge}>
              <Text style={styles.citationTypeBadgeText}>
                {citation.citationType.replace(/_/g, ' ')}
              </Text>
            </View>
            {citation.citedDocumentId ? (
              <Ionicons name="open-outline" size={14} color="#1a56db" />
            ) : null}
          </View>
          <Text style={styles.citationText} numberOfLines={2}>
            {citation.citationText}
          </Text>
          {citation.context ? (
            <Text style={styles.citationContext} numberOfLines={2}>
              {citation.context}
            </Text>
          ) : null}
          {citation.citedDocument ? (
            <Text style={styles.citedDocTitle} numberOfLines={1}>
              {citation.citedDocument.title}
            </Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </>
  );
}

function RelatedTab({
  documents,
  loading,
}: {
  documents: RelatedDocument[];
  loading: boolean;
}) {
  if (loading) {
    return <ActivityIndicator color="#1a56db" style={styles.tabLoader} />;
  }

  if (documents.length === 0) {
    return (
      <View style={styles.noContent}>
        <Ionicons name="git-compare-outline" size={32} color="#d1d5db" />
        <Text style={styles.noContentText}>
          No related documents found
        </Text>
      </View>
    );
  }

  return (
    <>
      {documents.map((doc) => (
        <TouchableOpacity
          key={doc.id}
          style={styles.relatedCard}
          onPress={() => router.push(`/reader/${doc.id}`)}
          activeOpacity={0.7}
        >
          <View style={styles.relatedHeader}>
            <View style={styles.relatedTypeBadge}>
              <Text style={styles.relatedTypeBadgeText}>
                {doc.documentType.replace(/_/g, ' ')}
              </Text>
            </View>
            <Text style={styles.relevanceScore}>
              {Math.round(doc.relevanceScore * 100)}% match
            </Text>
          </View>
          <Text style={styles.relatedTitle} numberOfLines={2}>
            {doc.title}
          </Text>
          <View style={styles.relatedMeta}>
            {doc.court ? (
              <Text style={styles.relatedMetaText}>
                {doc.court.replace(/_/g, ' ')}
              </Text>
            ) : null}
            {doc.grNo ? (
              <Text style={styles.relatedMetaText}>{doc.grNo}</Text>
            ) : null}
            {doc.decisionDate ? (
              <Text style={styles.relatedMetaText}>
                {new Date(doc.decisionDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                })}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 40 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  docHeader: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  badges: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  officialBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  officialBadgeText: { fontSize: 12, fontWeight: '600', color: '#059669' },
  docTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
    marginBottom: 12,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  metaItem: { minWidth: '40%' },
  metaLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '500', marginBottom: 2 },
  metaValue: { fontSize: 13, color: '#374151', fontWeight: '500' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  generateDigestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a56db',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  generateDigestText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  viewDigestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  viewDigestText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
  offlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a56db',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 60,
    justifyContent: 'center',
  },
  offlineButtonSaved: {
    borderColor: '#059669',
    backgroundColor: '#ecfdf5',
  },
  offlineButtonText: {
    fontSize: 13,
    color: '#1a56db',
    fontWeight: '600',
  },
  offlineButtonTextSaved: {
    color: '#059669',
  },
  bookmarkSection: { marginTop: 4 },
  bookmarkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  bookmarkedText: { fontSize: 13, color: '#1a56db', fontWeight: '600' },
  bookmarkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a56db',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  bookmarkButtonText: { fontSize: 13, color: '#1a56db', fontWeight: '600' },
  bookmarkForm: { gap: 8 },
  bookmarkInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#f9fafb',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  bookmarkActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  bookmarkCancel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  bookmarkCancelText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  bookmarkSave: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1a56db',
    minWidth: 60,
    alignItems: 'center',
  },
  bookmarkSaveText: { fontSize: 13, color: '#fff', fontWeight: '600' },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  tabContent: { padding: 16 },
  tabLoader: { paddingVertical: 20 },

  // Sections
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a56db',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pageRef: { fontSize: 11, color: '#9ca3af' },
  sectionText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  noSectionContentText: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic' },

  // No content
  noContent: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  noContentText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  // Citations
  citationCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  citationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  citationTypeBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  citationTypeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#92400e',
    textTransform: 'capitalize',
  },
  citationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 4,
  },
  citationContext: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  citedDocTitle: {
    fontSize: 12,
    color: '#1a56db',
    marginTop: 4,
    fontWeight: '500',
  },

  // Related
  relatedCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  relatedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  relatedTypeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  relatedTypeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  relevanceScore: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },
  relatedTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 6,
  },
  relatedMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  relatedMetaText: { fontSize: 12, color: '#6b7280' },
});
