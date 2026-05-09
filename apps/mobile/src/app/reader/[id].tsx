import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { DocumentReaderScreen } from '@/components/screens/DocumentReaderScreen';
import {
  useDocument,
  useDocumentSections,
} from '@/features/documents/hooks/use-document';
import {
  useBookmarks,
  useCreateBookmark,
} from '@/features/bookmarks/hooks/use-bookmarks';
import { useGenerateDigest } from '@/features/digests/hooks/use-digests';
import { useRecentlyViewed } from '@/features/documents/hooks/use-recently-viewed';
import { useTheme } from '@/providers/theme-provider';
import type { DocumentReaderSection } from '@/components/screens/DocumentReaderScreen';
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

function eyebrowFor(doc: LegalDocument): string {
  return DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType.replace(/_/g, ' ');
}

function metaFor(doc: LegalDocument): string | undefined {
  const parts: string[] = [];
  if (doc.citationText) parts.push(doc.citationText);
  else if (doc.grNo) parts.push(doc.grNo);
  if (doc.ponente) parts.push(doc.ponente);
  if (doc.decisionDate) {
    const d = new Date(doc.decisionDate);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
    }
  } else if (doc.promulgationDate) {
    const d = new Date(doc.promulgationDate);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
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
    }))
    .filter((s) => s.paragraphs.length > 0);
}

export default function ReaderRoute() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const documentId = id ?? '';

  const { data: doc, isLoading: docLoading, error: docError } = useDocument(documentId);
  const { data: sections } = useDocumentSections(documentId);
  const { data: bookmarksData } = useBookmarks({ legalDocumentId: documentId });
  const createBookmark = useCreateBookmark();
  const generateDigest = useGenerateDigest();
  const { addEntry: addRecentlyViewed } = useRecentlyViewed();

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

  const readerSections = useMemo(() => buildReaderSections(sections), [sections]);

  const handleBookmark = useCallback(async () => {
    if (isBookmarked) {
      Alert.alert('Bookmarked', 'This document is already in your bookmarks.');
      return;
    }
    try {
      await createBookmark.mutateAsync({ legalDocumentId: documentId });
      Alert.alert('Bookmarked', 'Document added to your bookmarks.');
    } catch {
      Alert.alert('Error', 'Failed to create bookmark. Please try again.');
    }
  }, [documentId, isBookmarked, createBookmark]);

  const handleGenerateDigest = useCallback(() => {
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
  }, [documentId, generateDigest]);

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

  return (
    <DocumentReaderScreen
      eyebrow={eyebrowFor(doc)}
      title={doc.shortTitle ?? doc.title}
      meta={metaFor(doc)}
      sections={readerSections}
      onBack={() => router.back()}
      onBookmark={handleBookmark}
      onAdd={handleGenerateDigest}
    />
  );
}
