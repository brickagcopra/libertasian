'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  usePleading,
  useDeletePleading,
} from '@/features/pleadings/hooks/use-pleadings';
import {
  PLEADING_CATEGORY_LABELS,
  PLEADING_STATUS_COLORS,
} from '@/features/pleadings/types';
import type { CitationRef, PleadingSectionOutput } from '@/features/pleadings/types';

export default function PleadingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pleadingId = params['id'] as string;

  const { data: pleading, isLoading, error } = usePleading(pleadingId);
  const deletePleading = useDeletePleading();

  const handleDelete = useCallback(() => {
    if (!pleading) return;
    if (
      window.confirm(
        'Are you sure you want to delete this pleading? This cannot be undone.',
      )
    ) {
      deletePleading.mutate(pleadingId, {
        onSuccess: () => router.push('/workspace/pleadings'),
      });
    }
  }, [pleading, pleadingId, deletePleading, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !pleading) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/pleadings"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Pleadings
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Pleading not found.'}
        </div>
      </div>
    );
  }

  const categoryLabel =
    PLEADING_CATEGORY_LABELS[pleading.template.category] ??
    pleading.template.category;
  const statusStyle =
    PLEADING_STATUS_COLORS[pleading.status] ?? 'bg-gray-100 text-gray-600';

  const generatedOutput = pleading.generatedOutput;
  const sections = (generatedOutput?.sections ?? []) as PleadingSectionOutput[];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/workspace/pleadings" className="hover:text-gray-700">
          Pleadings
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{pleading.template.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {(generatedOutput?.title as string) ?? pleading.template.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {categoryLabel}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {pleading.status}
            </span>
            <span>
              {new Date(pleading.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          {pleading.matter && (
            <p className="mt-1 text-sm text-gray-500">
              Matter:{' '}
              <Link
                href={`/workspace/matters/${pleading.matter.id}`}
                className="text-gray-700 underline hover:text-gray-900"
              >
                {pleading.matter.title}
              </Link>
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deletePleading.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deletePleading.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Input Data Summary */}
      {pleading.inputData && Object.keys(pleading.inputData).length > 0 && (
        <div className="rounded-md border bg-gray-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Input Data
          </p>
          <div className="mt-2 space-y-1">
            {Object.entries(pleading.inputData).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-sm">
                <span className="font-medium text-gray-600 capitalize">
                  {key.replace(/_/g, ' ')}:
                </span>
                <span className="text-gray-800">
                  {String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generating state */}
      {(pleading.status === 'pending' || pleading.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {pleading.status === 'pending'
                ? 'Pleading queued for generation...'
                : 'Generating your pleading...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 30 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {pleading.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Pleading generation failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to generate this pleading. Please try again with
            different inputs.
          </p>
        </div>
      )}

      {/* Completed - Generated Output */}
      {pleading.status === 'completed' && generatedOutput && (
        <div className="space-y-6">
          {/* Sections */}
          {sections.map((section, index) => (
            <PleadingSectionCard
              key={section.key || index}
              section={section}
              index={index}
            />
          ))}

          {/* Citations */}
          {pleading.citationsJson && pleading.citationsJson.length > 0 && (
            <div className="rounded-md border p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Sources ({pleading.citationsJson.length})
              </h2>
              <ul className="mt-2 space-y-1">
                {pleading.citationsJson.map((citation, i) => (
                  <li key={i} className="text-xs text-gray-600">
                    <span className="font-mono text-gray-400">
                      [{i + 1}]
                    </span>{' '}
                    {citation.text}
                    {citation.sourceId && (
                      <Link
                        href={`/reader/${citation.sourceId}`}
                        className="ml-1 text-blue-600 hover:underline"
                      >
                        View source
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PleadingSectionCard({
  section,
  index,
}: {
  section: PleadingSectionOutput;
  index: number;
}) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-base font-semibold text-gray-900">
        {index + 1}. {section.heading}
      </h2>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
        {section.content}
      </div>
      {section.citations && section.citations.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="text-xs font-medium text-gray-400">
            Citations in this section:
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {section.citations.map((c, i) => (
              <CitationTag key={i} citation={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CitationTag({ citation }: { citation: CitationRef }) {
  if (citation.sourceId) {
    return (
      <Link
        href={`/reader/${citation.sourceId}`}
        className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 hover:underline"
        title={citation.text}
      >
        Source {citation.sourceId.slice(0, 8)}
      </Link>
    );
  }
  return (
    <span
      className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
      title={citation.text}
    >
      {citation.text.slice(0, 40)}
    </span>
  );
}
