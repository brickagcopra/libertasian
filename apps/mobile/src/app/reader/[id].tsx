import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  DocumentReaderScreen,
  type DocumentReaderCitation,
  type DocumentReaderRelated,
  type DocumentReaderSection,
  type DocumentReaderTopAction,
} from '@/components/screens/DocumentReaderScreen';
import { Button } from '@/components/ui/Button';
import {
  useDocument,
  useDocumentSections,
} from '@/features/documents/hooks/use-document';
import {
  useDocumentCitations,
  useRelatedDocuments,
} from '@/features/documents/hooks/use-documents';
import {
  useBookmarks,
  useCreateBookmark,
} from '@/features/bookmarks/hooks/use-bookmarks';
import { useDigests, useGenerateDigest } from '@/features/digests/hooks/use-digests';
import { useRecentlyViewed } from '@/features/documents/hooks/use-recently-viewed';
import { useOfflineCodals } from '@/features/study/hooks/use-offline-codals';
import { ContentDisclaimer } from '@/features/documents/components/content-disclaimer';
import { useTheme } from '@/providers/theme-provider';
import type { DocumentSection, LegalDocument } from '@/features/documents/types';

const DOC_TYPE_LABELS: Record<string, string> = {
  supreme_court_decision: 'Supreme Court · Case',
  case_decision: 'Case',
  republic_act: 'Republic Act',
  statute: 'Statute',
  executive_order: 'Executive Order',
  administrative_order: 'Administrative Order',
  circular: 'Circular',
  resolution: 'Resolution',
};

// Codal-class document types — these are not case law, so the
// case-digest UI is hidden on the reader. KEEP IN SYNC with the
// web copy at apps/web/src/app/(dashboard)/reader/[id]/page.tsx
// and the server taxonomy in apps/api/src/modules/study/study.service.ts
// (TAB_GROUP_TO_TYPES).
const CODAL_DOCUMENT_TYPES = new Set<string>([
  'constitution',
  'codal',
  'statute',
  'republic_act',
  'commonwealth_act',
  'batas_pambansa',
  'executive_order',
  'presidential_decree',
  'proclamation',
  'administrative_order',
  'rules_of_court',
  'rule',
]);

function eyebrowFor(doc: LegalDocument): string {
  return DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType.replace(/_/g, ' ');
}

function metaFor(doc: LegalDocument): string | undefined {
  const parts: string[] = [];
  if (doc.citationText) parts.push(doc.citationText);
  else if (doc.grNo) parts.push(doc.grNo);
  if (doc.ponente) parts.push(doc.ponente);
  if (doc.decisionDate || doc.promulgationDate) {
    const d = new Date((doc.decisionDate ?? doc.promulgationDate)!);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function disclaimerClassFor(doc: LegalDocument): string | null {
  // Map document trust signals to ContentDisclaimer's known classes.
  if (doc.isOfficial) return 'official_text';
  if (doc.source?.trustLevel === 'community') return 'community';
  if (doc.truthfulnessStatus && doc.truthfulnessStatus !== 'verified') return 'ai_generated';
  return null;
}

function paragraphsFromSection(section: DocumentSection): string[] {
  const text = section.plainText?.trim();
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function headingFor(section: DocumentSection, index: number): string {
  if (section.sectionLabel) return section.sectionLabel;
  if (section.sectionType) {
    return section.sectionType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return `Section ${index + 1}`;
}

function buildReaderSections(sections: DocumentSection[] | undefined): DocumentReaderSection[] {
  if (!sections) return [];
  return sections
    .slice()
    .sort((a, b) => a.ordering - b.ordering)
    .map((s, i) => ({
      id: s.id,
      heading: headingFor(s, i),
      paragraphs: paragraphsFromSection(s),
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
    }))
    .filter((s) => s.paragraphs.length > 0);
}

export default function ReaderRoute() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const documentId = id ?? '';

  const { data: doc, isLoading: docLoading, error: docError } = useDocument(documentId);
  const { data: sections } = useDocumentSections(documentId);

  // Citations + related are lazy-loaded once a document loads.
  const enableExtras = Boolean(doc);
  const { data: citationsData, isLoading: citationsLoading } = useDocumentCitations(
    documentId,
    enableExtras,
  );
  const { data: relatedData, isLoading: relatedLoading } = useRelatedDocuments(
    documentId,
    enableExtras,
  );

  const isCodalDoc = doc ? CODAL_DOCUMENT_TYPES.has(doc.documentType) : false;
  const showDigestUI = !isCodalDoc;

  const { data: bookmarksData } = useBookmarks({ legalDocumentId: documentId });
  const createBookmark = useCreateBookmark();
  const { data: existingDigests } = useDigests(
    { legalDocumentId: documentId, limit: 1 },
    { enabled: showDigestUI },
  );
  const existingDigestId =
    existingDigests?.data && existingDigests.data.length > 0 ? existingDigests.data[0].id : null;
  const generateDigest = useGenerateDigest();
  const { addEntry: addRecentlyViewed } = useRecentlyViewed();
  const { isOffline, saveForOffline, removeOffline, saving } = useOfflineCodals();
  const documentIsOffline = isOffline(documentId);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  const isBookmarked = (bookmarksData?.data?.length ?? 0) > 0;
  const [bookmarkSheetOpen, setBookmarkSheetOpen] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');

  const readerSections = useMemo(() => buildReaderSections(sections), [sections]);

  const citations = useMemo<DocumentReaderCitation[] | undefined>(() => {
    if (!enableExtras) return undefined;
    if (!citationsData) return [];
    return citationsData.map((c) => ({
      id: c.id,
      citationText: c.citationText,
      context: c.context,
      citedTitle: c.citedDocument?.shortTitle ?? c.citedDocument?.title ?? null,
      onPress: c.citedDocument?.id
        ? () => router.push(`/reader/${c.citedDocument!.id}`)
        : undefined,
    }));
  }, [citationsData, enableExtras]);

  const relatedDocuments = useMemo<DocumentReaderRelated[] | undefined>(() => {
    if (!enableExtras) return undefined;
    if (!relatedData) return [];
    return relatedData.map((r) => ({
      id: r.id,
      title: r.shortTitle ?? r.title,
      subtitle: r.citationText ?? r.grNo ?? null,
      relevance: r.relevanceScore,
      onPress: () => router.push(`/reader/${r.id}`),
    }));
  }, [relatedData, enableExtras]);

  const submitBookmark = useCallback(async () => {
    try {
      await createBookmark.mutateAsync({
        legalDocumentId: documentId,
        note: bookmarkNote.trim() || undefined,
      });
      setBookmarkSheetOpen(false);
      setBookmarkNote('');
    } catch {
      Alert.alert('Error', 'Failed to create bookmark.');
    }
  }, [bookmarkNote, createBookmark, documentId]);

  const handleBookmark = useCallback(() => {
    if (isBookmarked) {
      Alert.alert('Bookmarked', 'This document is already in your bookmarks.');
      return;
    }
    setBookmarkSheetOpen(true);
  }, [isBookmarked]);

  const handleToggleOffline = useCallback(async () => {
    if (!doc) return;
    try {
      if (documentIsOffline) {
        await removeOffline(doc.id);
      } else {
        await saveForOffline(doc.id, doc.documentType);
      }
    } catch {
      Alert.alert('Error', 'Failed to update offline storage.');
    }
  }, [doc, documentIsOffline, removeOffline, saveForOffline]);

  const handleGenerateDigest = useCallback(() => {
    if (existingDigestId) {
      router.push(`/digest/${existingDigestId}`);
      return;
    }
    Alert.alert(
      'Generate digest',
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
              if (digestId) router.push(`/digest/${digestId}`);
            } catch {
              Alert.alert('Error', 'Failed to generate digest. Please try again.');
            }
          },
        },
      ],
    );
  }, [documentId, existingDigestId, generateDigest]);

  if (docLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.ink} />
      </View>
    );
  }

  if (docError || !doc) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: theme.serif, fontSize: 22, color: theme.ink, marginBottom: 8 }}>
          Document not found
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.inkSoft, textAlign: 'center' }}>
          The document you&apos;re looking for could not be loaded.
        </Text>
      </View>
    );
  }

  const disclaimerClass = disclaimerClassFor(doc);
  const disclaimerSlot = disclaimerClass ? (
    <ContentDisclaimer contentClass={disclaimerClass} />
  ) : null;

  const extraTopActions: DocumentReaderTopAction[] = [
    {
      icon: documentIsOffline ? 'cloud-done' : 'cloud-download-outline',
      accessibilityLabel: documentIsOffline ? 'Saved offline' : 'Save offline',
      badge: documentIsOffline,
      onPress: saving === doc.id ? undefined : handleToggleOffline,
    },
  ];

  const belowMetaSlot = showDigestUI && existingDigestId ? (
    <Pressable
      onPress={() => router.push(`/digest/${existingDigestId}`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.accentSoft,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_700Bold',
          fontSize: 11,
          color: theme.accent,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        Digest available
      </Text>
      <Text style={{ flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: theme.ink }}>
        Open the case digest →
      </Text>
    </Pressable>
  ) : null;

  return (
    <>
      <DocumentReaderScreen
        eyebrow={eyebrowFor(doc)}
        title={doc.shortTitle ?? doc.title}
        meta={metaFor(doc)}
        sections={readerSections}
        disclaimerSlot={disclaimerSlot}
        belowMetaSlot={belowMetaSlot}
        extraTopActions={extraTopActions}
        citations={citations}
        citationsLoading={citationsLoading}
        relatedDocuments={relatedDocuments}
        relatedLoading={relatedLoading}
        isBookmarked={isBookmarked}
        onBack={() => router.back()}
        onBookmark={handleBookmark}
        onAdd={showDigestUI ? handleGenerateDigest : undefined}
      />

      {/* Bookmark-with-note sheet */}
      <Modal
        visible={bookmarkSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setBookmarkSheetOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.bg,
              padding: 22,
              paddingBottom: 36,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
            }}
          >
            <Text style={{ fontFamily: theme.serif, fontSize: 24, letterSpacing: -0.5, color: theme.ink }}>
              Add a note
            </Text>
            <Text style={{ marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
              Optional — jot why this matters so you can find it later.
            </Text>
            <View style={{ height: 14 }} />
            <TextInput
              value={bookmarkNote}
              onChangeText={setBookmarkNote}
              placeholder="What stands out about this case?"
              placeholderTextColor={theme.inkFaint}
              multiline
              numberOfLines={4}
              style={{
                backgroundColor: theme.surface,
                borderColor: theme.line,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                minHeight: 96,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.ink,
                textAlignVertical: 'top',
              }}
            />
            <View style={{ height: 14 }} />
            <Button
              label={createBookmark.isPending ? 'Saving…' : 'Save bookmark'}
              variant="primary"
              full
              disabled={createBookmark.isPending}
              onPress={submitBookmark}
            />
            <View style={{ height: 8 }} />
            <Pressable
              onPress={() => {
                setBookmarkSheetOpen(false);
                setBookmarkNote('');
              }}
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
