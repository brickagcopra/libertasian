'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  BookmarkCheckIcon,
  FileTextIcon,
  HighlighterIcon,
  ExternalLinkIcon,
  LockIcon,
  Trash2Icon,
  XIcon,
  StickyNoteIcon,
} from 'lucide-react';

import { useDocument, useDocumentSections } from '@/features/documents/hooks/use-document';
import { useCreateBookmark, useBookmarks } from '@/features/bookmarks/hooks/use-bookmarks';
import { useDigests, useGenerateDigest } from '@/features/digests/hooks/use-digests';
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation } from '@/features/workspace/hooks/use-annotations';
import { ReaderSkeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { UpgradeBanner, extractPaywall402 } from '@/components/paywall/upgrade-banner';
import { useCanUseBookmarksAnnotations } from '@/hooks/useCanUseBookmarksAnnotations';
import type { Annotation, AnnotationColor, CreateAnnotationInput } from '@/features/workspace/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DigestContentPanel } from '@/features/digests/components/digest-content-panel';
import { AiSummaryTab } from './_components/ai-summary-tab';
import { DigestsTab } from './_components/digests-tab';

// Friendly copy shown when bookmark/annotation creation is blocked by the
// subscription gate (API returns 402/403 for free-tier orgs).
const UPGRADE_REQUIRED_MESSAGE =
  'Bookmarks and annotations are available on Edu plans and above — upgrade to save your work.';

/** True when the error is the subscription gate (402 Payment Required / 403 Forbidden). */
function isSubscriptionGateError(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    (error.statusCode === 402 || error.statusCode === 403)
  );
}

// -- Edu+ upsell --------------------------------------------------------------

/**
 * Proactive paywall shown in place of the bookmark button / annotation-create
 * submit for orgs known to be below the Edu tier (see
 * useCanUseBookmarksAnnotations). Static — nothing here can fire a mutation.
 */
function EduUpsellNotice() {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <LockIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Available on Edu plans and above</span>
      <Link
        href="/pricing"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        View plans
      </Link>
    </span>
  );
}

// -- Color maps ---------------------------------------------------------------

const HIGHLIGHT_BG: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-200/60',
  green: 'bg-green-200/60',
  blue: 'bg-blue-200/60',
  red: 'bg-red-200/60',
  purple: 'bg-purple-200/60',
};

const COLOR_LABELS: { value: AnnotationColor; label: string; dot: string }[] = [
  { value: 'yellow', label: 'Yellow', dot: 'bg-yellow-400' },
  { value: 'green', label: 'Green', dot: 'bg-green-400' },
  { value: 'blue', label: 'Blue', dot: 'bg-blue-400' },
  { value: 'red', label: 'Red', dot: 'bg-red-400' },
  { value: 'purple', label: 'Purple', dot: 'bg-purple-400' },
];

// Codal-class document types — these are not case law, so the
// case-digest UI (Generate Digest button, Digests tab, inline editorial
// digest card) is hidden on the reader. Keep this list in sync with
// TAB_GROUP_TO_TYPES in apps/api/src/modules/study/study.service.ts.
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

// -- Page Component -----------------------------------------------------------

export default function ReaderPage() {
  const params = useParams();
  const id = params['id'] as string;
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const { data: document, isLoading: docLoading, error: docError } = useDocument(id);
  const { data: sections, isLoading: sectionsLoading } = useDocumentSections(id);
  const { data: bookmarksData } = useBookmarks();
  const createBookmark = useCreateBookmark();
  const [bookmarkNote, setBookmarkNote] = useState('');
  const [showBookmarkForm, setShowBookmarkForm] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState('');

  const isCodalDoc = document ? CODAL_DOCUMENT_TYPES.has(document.documentType) : false;
  const showDigestUI = !isCodalDoc;

  const { data: digestsData } = useDigests(
    { legalDocumentId: id },
    { enabled: showDigestUI },
  );
  const generateDigest = useGenerateDigest();
  const [digestMsg, setDigestMsg] = useState('');

  // Annotations
  const { data: annotationsData } = useAnnotations(id);
  const annotations = annotationsData?.data ?? [];
  const [showAnnotations, setShowAnnotations] = useState(true);

  // Bookmarks + annotations are Edu+ features. When the org is KNOWN to be
  // below Edu, swap the create affordances for an upsell instead of letting
  // the request 403. While the subscription is loading/errored this stays
  // false and the 402/403 catch below remains the fallback.
  const { locked: paywallLocked } = useCanUseBookmarksAnnotations();

  const isBookmarked = bookmarksData?.data?.some((b) => b.legalDocumentId === id) ?? false;

  // Public editorial digest to show inline in fulltext view
  const editorialDigest = (digestsData?.data ?? []).find(
    (d) => d.visibility === 'public_editorial',
  );

  const handleBookmark = async () => {
    try {
      setBookmarkMsg('');
      await createBookmark.mutateAsync({
        legalDocumentId: id,
        note: bookmarkNote || undefined,
      });
      setBookmarkMsg('Bookmarked!');
      setShowBookmarkForm(false);
      setBookmarkNote('');
    } catch (error) {
      if (isSubscriptionGateError(error)) {
        setBookmarkMsg(UPGRADE_REQUIRED_MESSAGE);
      } else if (error instanceof ApiClientError) {
        setBookmarkMsg(error.message);
      } else {
        setBookmarkMsg('Failed to bookmark');
      }
    }
  };

  if (docLoading || sectionsLoading) {
    return <ReaderSkeleton />;
  }

  const paywall = extractPaywall402(docError);
  if (paywall) {
    return (
      <UpgradeBanner
        variant="modal"
        corpus={paywall.corpus}
        previewItemId={paywall.previewItemId}
        previewHref={
          paywall.previewItemId ? `/reader/${paywall.previewItemId}` : undefined
        }
        message={paywall.message}
        surface="reader/detail"
      />
    );
  }

  if (docError || !document) {
    return (
      <div className="space-y-4">
        <Button variant="link" asChild className="px-0">
          <Link href={ROUTES.SEARCH}>
            <ArrowLeftIcon className="mr-1.5 h-3.5 w-3.5" />
            Back to search
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            {docError instanceof Error ? docError.message : 'Document not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const displayType = document.documentType?.replace(/_/g, ' ') ?? 'Document';

  // Group annotations by sectionId
  const annotationsBySection = new Map<string, Annotation[]>();
  for (const a of annotations) {
    if (a.sectionId) {
      const list = annotationsBySection.get(a.sectionId) ?? [];
      list.push(a);
      annotationsBySection.set(a.sectionId, list);
    }
  }

  return (
    <div className="flex gap-6">
      {/* Section Navigation Sidebar */}
      {sections && sections.length > 1 && (
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-6 space-y-1">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Sections</p>
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSection(section.id);
                  globalThis.document
                    .getElementById(`section-${section.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
                  activeSection === section.id
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {section.sectionLabel ?? section.sectionType.replace(/_/g, ' ')}
              </button>
            ))}
          </nav>
        </aside>
      )}

      {/* Document Content */}
      <div className="min-w-0 flex-1 space-y-6">
        <Button variant="link" asChild className="px-0">
          <Link href={ROUTES.SEARCH}>
            <ArrowLeftIcon className="mr-1.5 h-3.5 w-3.5" />
            Back to search
          </Link>
        </Button>

        {/* Document Header */}
        <div>
          <h1 className="text-xl font-bold">{document.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="capitalize">
              {displayType}
            </Badge>
            {document.court && (
              <span>{document.court.replace(/_/g, ' ')}</span>
            )}
            {document.grNo && <span>{document.grNo}</span>}
            {document.ponente && <span>Ponente: {document.ponente}</span>}
            {document.decisionDate && (
              <span>Decided: {new Date(document.decisionDate).toLocaleDateString()}</span>
            )}
            {document.isOfficial && (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Official</Badge>
            )}
          </div>
          {document.citationText && (
            <p className="mt-2 text-sm text-muted-foreground">{document.citationText}</p>
          )}

          {/* Action Bar */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Bookmark */}
            {isBookmarked ? (
              <Badge className="bg-green-50 text-green-700 hover:bg-green-50">
                <BookmarkCheckIcon className="mr-1 h-3 w-3" />
                Bookmarked
              </Badge>
            ) : paywallLocked ? (
              <EduUpsellNotice />
            ) : showBookmarkForm ? (
              <div className="flex items-end gap-2">
                <Input
                  type="text"
                  value={bookmarkNote}
                  onChange={(e) => setBookmarkNote(e.target.value)}
                  placeholder="Add a note (optional)"
                  className="h-8 w-48 text-xs"
                />
                <Button
                  size="sm"
                  onClick={handleBookmark}
                  disabled={createBookmark.isPending}
                >
                  {createBookmark.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowBookmarkForm(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBookmarkForm(true)}
              >
                <BookmarkIcon className="mr-1.5 h-3.5 w-3.5" />
                Bookmark
              </Button>
            )}
            {bookmarkMsg && (
              <span className="text-xs text-muted-foreground">{bookmarkMsg}</span>
            )}

            {/* Digest Generation */}
            {showDigestUI && (
              <>
                {digestsData?.data?.[0] ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={ROUTES.DIGEST(digestsData.data[0].id)}>
                      <FileTextIcon className="mr-1.5 h-3.5 w-3.5" />
                      View Digest
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        setDigestMsg('');
                        await generateDigest.mutateAsync({ legalDocumentId: id });
                        setDigestMsg('Digest generated!');
                      } catch (error) {
                        if (error instanceof ApiClientError) {
                          setDigestMsg(error.message);
                        } else {
                          setDigestMsg('Failed to generate digest');
                        }
                      }
                    }}
                    disabled={generateDigest.isPending}
                  >
                    <FileTextIcon className="mr-1.5 h-3.5 w-3.5" />
                    {generateDigest.isPending ? 'Generating...' : 'Generate Digest'}
                  </Button>
                )}
                {digestMsg && (
                  <span className="text-xs text-muted-foreground">{digestMsg}</span>
                )}
              </>
            )}

            {/* Annotation Toggle */}
            <Button
              variant={showAnnotations ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowAnnotations((v) => !v)}
              className={showAnnotations ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' : ''}
            >
              <HighlighterIcon className="mr-1.5 h-3.5 w-3.5" />
              {showAnnotations ? 'Annotations ON' : 'Annotations OFF'}
            </Button>
            {annotations.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
              </span>
            )}
            <Button variant="link" size="sm" asChild className="px-0">
              <Link href={ROUTES.WORKSPACE_ANNOTATIONS}>
                <ExternalLinkIcon className="mr-1 h-3 w-3" />
                View all annotations
              </Link>
            </Button>
          </div>

          <Separator className="mt-4" />
        </div>

        {/* Tabbed Content */}
        <Tabs defaultValue="fulltext">
          <TabsList>
            <TabsTrigger value="fulltext">Full Text</TabsTrigger>
            <TabsTrigger value="summary">AI Summary</TabsTrigger>
            {showDigestUI && (
              <TabsTrigger value="digests">
                Digests{digestsData?.data?.length ? ` (${digestsData.data.length})` : ''}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="fulltext" className="mt-4">
            {/* Inline editorial digest */}
            {showDigestUI && editorialDigest && (
              <Card className="mb-6 border-blue-200 bg-blue-50/30">
                <CardContent className="pt-5">
                  <div className="mb-3 flex items-center gap-2">
                    <FileTextIcon className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-800">Case Digest</span>
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                      Approved
                    </Badge>
                  </div>
                  <DigestContentPanel
                    digest={editorialDigest}
                    showHeader={false}
                  />
                </CardContent>
              </Card>
            )}

            {sections && sections.length > 0 ? (
              <div className="space-y-8">
                {sections.map((section) => (
                  <AnnotatedSection
                    key={section.id}
                    section={section}
                    documentId={id}
                    annotations={
                      showAnnotations ? (annotationsBySection.get(section.id) ?? []) : []
                    }
                    showAnnotations={showAnnotations}
                    paywallLocked={paywallLocked}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No sections available for this document.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="summary" className="mt-4">
            <AiSummaryTab documentId={id} />
          </TabsContent>

          {showDigestUI && (
            <TabsContent value="digests" className="mt-4">
              <DigestsTab documentId={id} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

// -- Annotated Section --------------------------------------------------------

interface DocumentSection {
  id: string;
  sectionType: string;
  sectionLabel: string | null;
  plainText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
}

/** Clean up LawPhil-scraped text for readable display */
function cleanLegalText(text: string): string {
  let cleaned = text;
  // Remove standalone footnote reference numbers (e.g., "\n46\n")
  cleaned = cleaned.replace(/\n\s*\d{1,3}\s*\n/g, '\n');
  // Collapse runs of single line breaks into spaces (paragraph reflow)
  // But preserve double line breaks (actual paragraph breaks)
  cleaned = cleaned.replace(/([^\n])\n([^\n])/g, '$1 $2');
  // Normalize multiple spaces into single space
  cleaned = cleaned.replace(/ {2,}/g, ' ');
  // Ensure paragraph breaks are clean double newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function AnnotatedSection({
  section,
  documentId,
  annotations,
  showAnnotations,
  paywallLocked,
}: {
  section: DocumentSection;
  documentId: string;
  annotations: Annotation[];
  showAnnotations: boolean;
  paywallLocked: boolean;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const [selectionPopup, setSelectionPopup] = useState<{
    x: number;
    y: number;
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);

  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [annotationMsg, setAnnotationMsg] = useState('');

  // Handle text selection within the section
  const handleMouseUp = useCallback(() => {
    const selection = globalThis.window.getSelection();
    if (!selection || selection.isCollapsed || !sectionRef.current) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!sectionRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 3) return;

    const sectionText = section.plainText ?? '';
    const startOffset = sectionText.indexOf(selectedText);
    if (startOffset === -1) return;

    const rect = range.getBoundingClientRect();
    const containerRect = sectionRef.current.getBoundingClientRect();

    setSelectionPopup({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      text: selectedText,
      startOffset,
      endOffset: startOffset + selectedText.length,
    });
  }, [section.plainText]);

  // Dismiss popup on outside click
  useEffect(() => {
    const dismiss = () => {
      setSelectionPopup(null);
      setActiveAnnotation(null);
    };
    globalThis.document.addEventListener('mousedown', dismiss);
    return () => globalThis.document.removeEventListener('mousedown', dismiss);
  }, []);

  const plainText = cleanLegalText(section.plainText ?? 'No content available');

  // Build the rendered content with highlights
  const rendered = showAnnotations && annotations.length > 0
    ? renderWithHighlights(plainText, annotations, (a) => {
        setActiveAnnotation(activeAnnotation?.id === a.id ? null : a);
        setSelectionPopup(null);
      })
    : plainText;

  return (
    <div
      id={`section-${section.id}`}
      className="scroll-mt-6 border-b border-gray-100 pb-8 last:border-0"
    >
      {section.sectionLabel && (
        <h2 className="mb-3 border-b border-gray-200 pb-2 text-base font-bold capitalize text-foreground">
          {section.sectionLabel}
        </h2>
      )}
      <div
        ref={sectionRef}
        className="relative whitespace-pre-wrap text-base leading-7 text-gray-800"
        onMouseUp={handleMouseUp}
      >
        {rendered}

        {/* Selection Popup — create annotation */}
        {selectionPopup && (
          <AnnotationCreatePopup
            x={selectionPopup.x}
            y={selectionPopup.y}
            text={selectionPopup.text}
            documentId={documentId}
            sectionId={section.id}
            startOffset={selectionPopup.startOffset}
            endOffset={selectionPopup.endOffset}
            isPending={createAnnotation.isPending}
            locked={paywallLocked}
            onSave={async (input) => {
              try {
                setAnnotationMsg('');
                await createAnnotation.mutateAsync(input);
                setSelectionPopup(null);
                globalThis.window.getSelection()?.removeAllRanges();
              } catch (error) {
                setSelectionPopup(null);
                if (isSubscriptionGateError(error)) {
                  setAnnotationMsg(UPGRADE_REQUIRED_MESSAGE);
                } else if (error instanceof ApiClientError) {
                  setAnnotationMsg(error.message);
                } else {
                  setAnnotationMsg('Failed to save annotation');
                }
              }
            }}
            onCancel={() => setSelectionPopup(null)}
          />
        )}

        {/* Active annotation detail popover */}
        {activeAnnotation && (
          <AnnotationPopover
            annotation={activeAnnotation}
            onClose={() => setActiveAnnotation(null)}
            onDelete={async () => {
              await deleteAnnotation.mutateAsync(activeAnnotation.id);
              setActiveAnnotation(null);
            }}
            isDeleting={deleteAnnotation.isPending}
          />
        )}
      </div>
      {annotationMsg && (
        <Alert className="mt-2">
          <AlertDescription className="text-xs">{annotationMsg}</AlertDescription>
        </Alert>
      )}
      {section.pageStart != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Page {section.pageStart}
          {section.pageEnd != null && section.pageEnd !== section.pageStart
            ? `\u2013${section.pageEnd}`
            : ''}
        </p>
      )}
    </div>
  );
}

// -- Render text with annotation highlights -----------------------------------

function renderWithHighlights(
  text: string,
  annotations: Annotation[],
  onAnnotationClick: (a: Annotation) => void,
): React.ReactNode[] {
  if (annotations.length === 0) return [text];

  const sorted = [...annotations].sort(
    (a, b) => a.textAnchor.startOffset - b.textAnchor.startOffset,
  );

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const annotation of sorted) {
    const { startOffset, endOffset } = annotation.textAnchor;

    const start = Math.max(0, Math.min(startOffset, text.length));
    const end = Math.max(start, Math.min(endOffset, text.length));

    if (start < lastEnd) continue;

    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }

    const color = (annotation.color as AnnotationColor) || 'yellow';
    const bgClass = HIGHLIGHT_BG[color] ?? HIGHLIGHT_BG.yellow;

    parts.push(
      <mark
        key={annotation.id}
        className={`cursor-pointer rounded-sm ${bgClass}`}
        title={annotation.annotationText ?? 'Click to view annotation'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onAnnotationClick(annotation);
        }}
      >
        {text.slice(start, end)}
      </mark>,
    );

    lastEnd = end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return parts;
}

// -- Create Annotation Popup --------------------------------------------------

function AnnotationCreatePopup({
  x,
  y,
  text,
  documentId,
  sectionId,
  startOffset,
  endOffset,
  isPending,
  locked,
  onSave,
  onCancel,
}: {
  x: number;
  y: number;
  text: string;
  documentId: string;
  sectionId: string;
  startOffset: number;
  endOffset: number;
  isPending: boolean;
  locked: boolean;
  onSave: (input: CreateAnnotationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [color, setColor] = useState<AnnotationColor>('yellow');
  const [annotationText, setAnnotationText] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleQuickSave = async (selectedColor: AnnotationColor) => {
    await onSave({
      legalDocumentId: documentId,
      sectionId,
      textAnchor: { startOffset, endOffset, anchorText: text },
      color: selectedColor,
    });
  };

  const handleDetailedSave = async () => {
    await onSave({
      legalDocumentId: documentId,
      sectionId,
      textAnchor: { startOffset, endOffset, anchorText: text },
      annotationText: annotationText || undefined,
      color,
    });
  };

  return (
    <div
      className="absolute z-50"
      style={{ left: `${x}px`, top: `${y}px`, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Card className="shadow-lg">
        <CardContent className="p-2">
          {locked ? (
            // Below-Edu orgs: replace the highlight/note submit with the
            // upsell — no annotation request can fire from this popup.
            <div className="max-w-[240px] space-y-1 p-1">
              <EduUpsellNotice />
              <p className="max-w-[220px] truncate text-xs text-muted-foreground">
                &ldquo;{text.slice(0, 60)}{text.length > 60 ? '...' : ''}&rdquo;
              </p>
            </div>
          ) : !expanded ? (
            <>
              {/* Quick color picker */}
              <TooltipProvider>
                <div className="flex items-center gap-1">
                  {COLOR_LABELS.map(({ value, label, dot }) => (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <button
                          disabled={isPending}
                          onClick={() => handleQuickSave(value)}
                          className={`h-6 w-6 rounded-full ${dot} hover:ring-2 hover:ring-ring hover:ring-offset-1 disabled:opacity-50`}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Highlight {label}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  <Separator orientation="vertical" className="mx-1 h-5" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(true)}
                    className="h-6 px-2 text-xs"
                  >
                    <StickyNoteIcon className="mr-1 h-3 w-3" />
                    Note
                  </Button>
                </div>
              </TooltipProvider>
              <p className="mt-1 max-w-[200px] truncate text-xs text-muted-foreground">
                &ldquo;{text.slice(0, 60)}{text.length > 60 ? '...' : ''}&rdquo;
              </p>
            </>
          ) : (
            <div className="w-64 space-y-2">
              <p className="max-h-12 overflow-hidden text-xs text-muted-foreground">
                &ldquo;{text.slice(0, 100)}{text.length > 100 ? '...' : ''}&rdquo;
              </p>
              <div className="flex gap-1">
                {COLOR_LABELS.map(({ value, dot }) => (
                  <button
                    key={value}
                    onClick={() => setColor(value)}
                    className={`h-5 w-5 rounded-full ${dot} ${
                      color === value ? 'ring-2 ring-ring ring-offset-1' : ''
                    }`}
                  />
                ))}
              </div>
              <textarea
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full rounded-md border px-2 py-1.5 text-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                rows={2}
                autoFocus
              />
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2 text-xs">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleDetailedSave} disabled={isPending} className="h-7 px-2 text-xs">
                  {isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// -- Annotation Popover -------------------------------------------------------

function AnnotationPopover({
  annotation,
  onClose,
  onDelete,
  isDeleting,
}: {
  annotation: Annotation;
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const color = (annotation.color as AnnotationColor) || 'yellow';
  const dotClass = COLOR_LABELS.find((c) => c.value === color)?.dot ?? 'bg-yellow-400';

  return (
    <div
      className="absolute right-0 top-0 z-40 w-64"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Card className="shadow-lg">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-full ${dotClass}`} />
              <span className="text-xs font-medium">Annotation</span>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-5 w-5 p-0">
              <XIcon className="h-3 w-3" />
            </Button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            &ldquo;{annotation.textAnchor.anchorText.slice(0, 100)}
            {annotation.textAnchor.anchorText.length > 100 ? '...' : ''}&rdquo;
          </p>

          {annotation.annotationText && (
            <p className="mt-2 text-sm">{annotation.annotationText}</p>
          )}

          <Separator className="my-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{new Date(annotation.createdAt).toLocaleDateString()}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={isDeleting}
            >
              <Trash2Icon className="mr-1 h-3 w-3" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
