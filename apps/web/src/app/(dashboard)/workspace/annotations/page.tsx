'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useAnnotations, useDeleteAnnotation } from '@/features/workspace/hooks/use-annotations';
import { ROUTES } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';
import type { Annotation, AnnotationColor } from '@/features/workspace/types';

const COLOR_STYLES: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-100 border-yellow-300 text-yellow-900',
  green: 'bg-green-100 border-green-300 text-green-900',
  blue: 'bg-blue-100 border-blue-300 text-blue-900',
  red: 'bg-red-100 border-red-300 text-red-900',
  purple: 'bg-purple-100 border-purple-300 text-purple-900',
};

const COLOR_DOT: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-green-400',
  blue: 'bg-blue-400',
  red: 'bg-red-400',
  purple: 'bg-purple-400',
};

export default function AnnotationsPage() {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, error } = useAnnotations();
  const deleteAnnotation = useDeleteAnnotation();

  const annotations = data?.data ?? [];

  // Client-side filtering (search + optional document)
  const filtered = annotations.filter((a) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      a.textAnchor.anchorText.toLowerCase().includes(term) ||
      (a.annotationText ?? '').toLowerCase().includes(term) ||
      a.legalDocument.title.toLowerCase().includes(term) ||
      (a.legalDocument.citationText ?? '').toLowerCase().includes(term)
    );
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleDelete = (annotation: Annotation) => {
    const preview = annotation.textAnchor.anchorText.slice(0, 50);
    if (window.confirm(`Delete annotation on "${preview}..."?`)) {
      deleteAnnotation.mutate(annotation.id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Annotations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your highlights and annotations across legal documents
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder="Search annotations..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Search
        </button>
      </form>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load annotations:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-500">No annotations found.</p>
          <p className="mt-1 text-sm text-gray-400">
            Select text while reading a document to create annotations.
          </p>
        </div>
      )}

      {/* Grouped by document */}
      <AnnotationsByDocument
        annotations={filtered}
        onDelete={handleDelete}
        isDeleting={deleteAnnotation.isPending}
      />
    </div>
  );
}

// -- Group annotations by document --------------------------------------------

function AnnotationsByDocument({
  annotations,
  onDelete,
  isDeleting,
}: {
  annotations: Annotation[];
  onDelete: (a: Annotation) => void;
  isDeleting: boolean;
}) {
  // Group by legalDocumentId
  const grouped = new Map<string, { doc: Annotation['legalDocument']; items: Annotation[] }>();
  for (const a of annotations) {
    const existing = grouped.get(a.legalDocumentId);
    if (existing) {
      existing.items.push(a);
    } else {
      grouped.set(a.legalDocumentId, { doc: a.legalDocument, items: [a] });
    }
  }

  if (grouped.size === 0) return null;

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([docId, { doc, items }]) => (
        <div key={docId} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <Link
              href={ROUTES.READER(docId)}
              className="text-sm font-semibold text-gray-900 hover:text-gray-700"
            >
              {doc.title}
            </Link>
            {doc.citationText && (
              <span className="text-xs text-gray-400">{doc.citationText}</span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {items.length}
            </span>
          </div>
          <div className="space-y-2 pl-3">
            {items.map((annotation) => (
              <AnnotationCard
                key={annotation.id}
                annotation={annotation}
                onDelete={() => onDelete(annotation)}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// -- Annotation Card ----------------------------------------------------------

function AnnotationCard({
  annotation,
  onDelete,
  isDeleting,
}: {
  annotation: Annotation;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const color = (annotation.color as AnnotationColor) || 'yellow';
  const colorStyle = COLOR_STYLES[color] ?? COLOR_STYLES.yellow;
  const dotStyle = COLOR_DOT[color] ?? COLOR_DOT.yellow;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Highlighted text */}
          <div className={`rounded border px-3 py-2 text-sm ${colorStyle}`}>
            &ldquo;{annotation.textAnchor.anchorText}&rdquo;
          </div>

          {/* Annotation text */}
          {annotation.annotationText && (
            <p className="mt-2 text-sm text-gray-700">{annotation.annotationText}</p>
          )}

          {/* Metadata */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotStyle}`} />
            {annotation.section && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5">
                {annotation.section.sectionLabel ?? annotation.section.sectionType}
              </span>
            )}
            <span>{new Date(annotation.createdAt).toLocaleDateString()}</span>
            <Link
              href={ROUTES.READER(annotation.legalDocumentId)}
              className="text-blue-600 hover:text-blue-800"
            >
              View in reader
            </Link>
          </div>
        </div>

        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
