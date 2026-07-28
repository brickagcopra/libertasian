import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  DocumentReaderScreen,
  type DocumentReaderCitation,
  type DocumentReaderParagraph,
  type DocumentReaderRelated,
  type DocumentReaderSection,
  type DocumentReaderTopAction,
} from '@/components/screens/DocumentReaderScreen';
import { Button } from '@/components/ui/Button';
import { ApiClientError } from '@/lib/api-client';
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
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
} from '@/features/annotations/hooks/use-annotations';
import {
  ANNOTATION_COLOR_ORDER,
  ANNOTATION_COLOR_STYLES,
  annotationColorStyle,
} from '@/features/annotations/colors';
import type { Annotation, AnnotationColor } from '@/features/annotations/types';
import { useCanUseBookmarksAnnotations } from '@/features/billing/hooks/use-can-use-bookmarks-annotations';
import { useCanUseOffline } from '@/features/billing/hooks/use-can-use-offline';
import { PlanUpsellSheet } from '@/features/billing/components/plan-upsell-sheet';
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

/**
 * Attach annotations to the paragraphs they anchor. Paragraph offsets into
 * section.plainText are recovered with a forward-moving indexOf cursor (so
 * duplicate paragraph text resolves to the correct occurrence) and threaded
 * onto each paragraph for annotation creation. An annotation matches a
 * paragraph when their offset ranges overlap — so highlights created on web
 * (arbitrary selections) surface on mobile too. ALL overlapping annotations
 * are attached; the first drives the paragraph tint.
 */
function buildParagraphs(
  section: DocumentSection,
  annotations: Annotation[] | undefined,
): DocumentReaderParagraph[] {
  const texts = paragraphsFromSection(section);
  const plainText = section.plainText ?? '';
  let cursor = 0;
  return texts.map((text) => {
    const start = plainText.indexOf(text, cursor);
    const end = start === -1 ? -1 : start + text.length;
    if (start !== -1) cursor = end;
    const offset = start === -1 ? undefined : start;
    if (!annotations || annotations.length === 0) return { text, offset };
    const matches =
      start === -1
        ? annotations.filter((a) => a.textAnchor.anchorText === text)
        : annotations.filter(
            (a) => a.textAnchor.startOffset < end && a.textAnchor.endOffset > start,
          );
    if (matches.length === 0) return { text, offset };
    return {
      text,
      offset,
      annotations: matches.map((m) => {
        const { tint, solid } = annotationColorStyle(m.color);
        return { id: m.id, tint, solid };
      }),
    };
  });
}

function buildReaderSections(
  sections: DocumentSection[] | undefined,
  annotations: Annotation[] | undefined,
): DocumentReaderSection[] {
  if (!sections) return [];
  const bySection = new Map<string, Annotation[]>();
  for (const a of annotations ?? []) {
    if (!a.sectionId) continue;
    const list = bySection.get(a.sectionId);
    if (list) list.push(a);
    else bySection.set(a.sectionId, [a]);
  }
  return sections
    .slice()
    .sort((a, b) => a.ordering - b.ordering)
    .map((s, i) => ({
      id: s.id,
      heading: headingFor(s, i),
      paragraphs: buildParagraphs(s, bySection.get(s.id)),
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

  // Bookmarks + annotations are Edu+ features (SubscriptionGuard on the
  // POST endpoints). When the org is KNOWN to be below Edu, the affordances
  // stay visible but open the upsell sheet instead of the create sheets.
  // While the subscription is loading/undetermined this reports locked:false
  // and the 402/403 Alert catches below remain the fallback.
  const { locked: paywallLocked, planName } = useCanUseBookmarksAnnotations();
  // Saving a document for offline reading is the `offlineReading` entitlement
  // (Edu+). Same proactive-paywall treatment; removing an already-saved
  // document stays available on every plan so cached content is never stranded.
  const { locked: offlineLocked } = useCanUseOffline();
  /** Which feature opened the Edu+ upsell sheet; null = sheet closed. */
  const [upsellFeature, setUpsellFeature] = useState<
    'bookmarks' | 'offline' | null
  >(null);

  // Annotations — whole-paragraph highlights (see buildParagraphs).
  const { data: annotations } = useAnnotations(documentId);
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();
  const [annotationTarget, setAnnotationTarget] = useState<{
    sectionId: string;
    paragraphText: string;
    /** Paragraph's precomputed offset in section.plainText (see buildParagraphs). */
    startOffset?: number;
  } | null>(null);
  const [annotationColor, setAnnotationColor] = useState<AnnotationColor>('yellow');
  const [annotationNote, setAnnotationNote] = useState('');
  // All annotations overlapping the tapped paragraph; empty = sheet closed.
  const [viewedAnnotations, setViewedAnnotations] = useState<Annotation[]>([]);

  const readerSections = useMemo(
    () => buildReaderSections(sections, annotations),
    [sections, annotations],
  );

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
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.statusCode === 402 || error.statusCode === 403)
      ) {
        Alert.alert(
          'Upgrade required',
          'Bookmarks and annotations are available on Edu plans and above — upgrade to save your work.',
        );
      } else {
        Alert.alert('Error', 'Failed to create bookmark.');
      }
    }
  }, [bookmarkNote, createBookmark, documentId]);

  const handleBookmark = useCallback(() => {
    if (isBookmarked) {
      Alert.alert('Bookmarked', 'This document is already in your bookmarks.');
      return;
    }
    if (paywallLocked) {
      setUpsellFeature('bookmarks');
      return;
    }
    setBookmarkSheetOpen(true);
  }, [isBookmarked, paywallLocked]);

  const handleParagraphLongPress = useCallback(
    (sectionId: string, paragraphText: string, startOffset?: number) => {
      if (paywallLocked) {
        setUpsellFeature('bookmarks');
        return;
      }
      setAnnotationColor('yellow');
      setAnnotationNote('');
      setAnnotationTarget({ sectionId, paragraphText, startOffset });
    },
    [paywallLocked],
  );

  const handleAnnotationPress = useCallback(
    (annotationIds: string[]) => {
      const idSet = new Set(annotationIds);
      const found = (annotations ?? []).filter((a) => idSet.has(a.id));
      if (found.length > 0) setViewedAnnotations(found);
    },
    [annotations],
  );

  const submitAnnotation = useCallback(async () => {
    if (!annotationTarget) return;
    // The anchor offset is precomputed per paragraph in buildParagraphs (a
    // fresh indexOf here would mis-anchor duplicate paragraph text to the
    // first occurrence). If it genuinely couldn't be determined, abort.
    const { startOffset } = annotationTarget;
    if (startOffset === undefined) {
      setAnnotationTarget(null);
      Alert.alert('Error', 'Could not anchor the highlight to this paragraph.');
      return;
    }
    try {
      await createAnnotation.mutateAsync({
        legalDocumentId: documentId,
        sectionId: annotationTarget.sectionId,
        textAnchor: {
          startOffset,
          endOffset: startOffset + annotationTarget.paragraphText.length,
          anchorText: annotationTarget.paragraphText,
        },
        annotationText: annotationNote.trim() || undefined,
        color: annotationColor,
      });
      setAnnotationTarget(null);
      setAnnotationNote('');
    } catch (error) {
      // Annotation creation is tier-gated server-side — surface the server's
      // message for plan/permission rejections instead of a generic error.
      if (
        error instanceof ApiClientError &&
        (error.statusCode === 403 || error.statusCode === 402)
      ) {
        Alert.alert('Upgrade required', error.serverMessage);
        return;
      }
      Alert.alert('Error', 'Failed to save the annotation.');
    }
  }, [
    annotationColor,
    annotationNote,
    annotationTarget,
    createAnnotation,
    documentId,
  ]);

  const handleDeleteAnnotation = useCallback(
    (annotation: Annotation) => {
      Alert.alert('Delete annotation', 'Remove this highlight and its note?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAnnotation.mutateAsync(annotation.id);
              // Drop the deleted entry from the open sheet; close when empty.
              setViewedAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
            } catch {
              Alert.alert('Error', 'Failed to delete the annotation.');
            }
          },
        },
      ]);
    },
    [deleteAnnotation],
  );

  const handleToggleOffline = useCallback(async () => {
    if (!doc) return;
    // Gate NEW saves only — removal (and reading what is already cached)
    // stays available on every plan.
    if (!documentIsOffline && offlineLocked) {
      setUpsellFeature('offline');
      return;
    }
    try {
      if (documentIsOffline) {
        await removeOffline(doc.id);
      } else {
        await saveForOffline(doc.id, doc.documentType);
      }
    } catch {
      Alert.alert('Error', 'Failed to update offline storage.');
    }
  }, [doc, documentIsOffline, offlineLocked, removeOffline, saveForOffline]);

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
        onParagraphLongPress={handleParagraphLongPress}
        onAnnotationPress={handleAnnotationPress}
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

      {/* Create-annotation sheet — long-press on a paragraph */}
      <Modal
        visible={annotationTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAnnotationTarget(null)}
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
              Highlight paragraph
            </Text>
            {annotationTarget ? (
              <Text
                numberOfLines={3}
                style={{
                  marginTop: 8,
                  fontFamily: theme.serif,
                  fontSize: 14,
                  lineHeight: 20,
                  color: theme.inkSoft,
                  fontStyle: 'italic',
                }}
              >
                “{annotationTarget.paragraphText}”
              </Text>
            ) : null}
            <View style={{ height: 16 }} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {ANNOTATION_COLOR_ORDER.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setAnnotationColor(c)}
                  accessibilityLabel={`Highlight color ${c}`}
                  accessibilityState={{ selected: annotationColor === c }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: ANNOTATION_COLOR_STYLES[c].solid,
                    borderWidth: annotationColor === c ? 3 : 1,
                    borderColor: annotationColor === c ? theme.ink : theme.line,
                  }}
                />
              ))}
            </View>
            <View style={{ height: 14 }} />
            <TextInput
              value={annotationNote}
              onChangeText={setAnnotationNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={theme.inkFaint}
              multiline
              numberOfLines={3}
              style={{
                backgroundColor: theme.surface,
                borderColor: theme.line,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                minHeight: 76,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.ink,
                textAlignVertical: 'top',
              }}
            />
            <View style={{ height: 14 }} />
            <Button
              label={createAnnotation.isPending ? 'Saving…' : 'Save highlight'}
              variant="primary"
              full
              disabled={createAnnotation.isPending}
              onPress={submitAnnotation}
            />
            <View style={{ height: 8 }} />
            <Pressable
              onPress={() => {
                setAnnotationTarget(null);
                setAnnotationNote('');
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

      {/* View/delete-annotations sheet — tap on an annotated paragraph.
          Lists EVERY annotation overlapping the paragraph, each with its own
          color dot, note, and delete action. */}
      <Modal
        visible={viewedAnnotations.length > 0}
        transparent
        animationType="slide"
        onRequestClose={() => setViewedAnnotations([])}
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
              {viewedAnnotations.length > 1
                ? `Annotations (${viewedAnnotations.length})`
                : 'Annotation'}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {viewedAnnotations.map((a, i) => (
                <View
                  key={a.id}
                  style={{
                    marginTop: i === 0 ? 12 : 16,
                    paddingTop: i === 0 ? 0 : 16,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: theme.line,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        marginTop: 3,
                        backgroundColor: annotationColorStyle(a.color).solid,
                      }}
                    />
                    <Text
                      numberOfLines={3}
                      style={{
                        flex: 1,
                        fontFamily: theme.serif,
                        fontSize: 14,
                        lineHeight: 20,
                        color: theme.inkSoft,
                        fontStyle: 'italic',
                      }}
                    >
                      “{a.textAnchor.anchorText}”
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 10,
                      fontFamily: 'Inter_400Regular',
                      fontSize: 14,
                      lineHeight: 20,
                      color: a.annotationText ? theme.ink : theme.inkFaint,
                    }}
                  >
                    {a.annotationText ?? 'No note added.'}
                  </Text>
                  <View style={{ height: 12 }} />
                  <Button
                    label={deleteAnnotation.isPending ? 'Deleting…' : 'Delete highlight'}
                    variant="destructive"
                    full
                    disabled={deleteAnnotation.isPending}
                    onPress={() => handleDeleteAnnotation(a)}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ height: 8 }} />
            <Pressable
              onPress={() => setViewedAnnotations([])}
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edu+ upsell sheet — bookmark button / paragraph long-press / save
          offline for below-Edu orgs. Proactive paywall: no create request
          ever fires and nothing is written to offline storage. */}
      <PlanUpsellSheet
        visible={upsellFeature !== null}
        planName={planName}
        message={
          upsellFeature === 'offline'
            ? 'Save documents for offline reading anywhere.'
            : 'Save bookmarks and highlight passages with notes.'
        }
        onClose={() => setUpsellFeature(null)}
      />
    </>
  );
}
