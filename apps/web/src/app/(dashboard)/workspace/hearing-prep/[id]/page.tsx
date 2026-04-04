'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  useHearingPrep,
  useDeleteHearingPrep,
} from '@/features/hearing-prep/hooks/use-hearing-prep';
import {
  HEARING_PREP_STATUS_COLORS,
  HEARING_PREP_STATUS_LABELS,
  ARGUMENT_STRENGTH_COLORS,
  ARGUMENT_STRENGTH_LABELS,
} from '@/features/hearing-prep/types';
import type {
  HearingPrepArgument,
  HearingPrepCase,
  HearingPrepProvision,
} from '@/features/hearing-prep/types';

export default function HearingPrepDetailPage() {
  const params = useParams();
  const router = useRouter();
  const packId = params['id'] as string;

  const { data: pack, isLoading, error } = useHearingPrep(packId);
  const deleteHearingPrep = useDeleteHearingPrep();

  const handleDelete = useCallback(() => {
    if (!pack) return;
    if (
      window.confirm(
        'Are you sure you want to delete this hearing prep pack? This cannot be undone.',
      )
    ) {
      deleteHearingPrep.mutate(packId, {
        onSuccess: () => router.push('/workspace/hearing-prep'),
      });
    }
  }, [pack, packId, deleteHearingPrep, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/hearing-prep"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Hearing Prep
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Hearing prep pack not found.'}
        </div>
      </div>
    );
  }

  const statusLabel =
    HEARING_PREP_STATUS_LABELS[pack.status] ?? pack.status;
  const statusStyle =
    HEARING_PREP_STATUS_COLORS[pack.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/workspace/hearing-prep" className="hover:text-gray-700">
          Hearing Prep
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 line-clamp-1">{pack.topic}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">{pack.topic}</h1>
          {pack.issue && (
            <p className="mt-1 text-sm text-gray-600">{pack.issue}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(pack.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          {pack.matter && (
            <p className="mt-1 text-sm text-gray-500">
              Matter:{' '}
              <Link
                href={`/workspace/matters/${pack.matter.id}`}
                className="text-gray-700 underline hover:text-gray-900"
              >
                {pack.matter.title}
              </Link>
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteHearingPrep.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteHearingPrep.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Generating state */}
      {(pack.status === 'pending' || pack.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {pack.status === 'pending'
                ? 'Hearing prep queued for generation...'
                : 'Generating your prep pack...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 60 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {pack.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Hearing prep generation failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to generate this prep pack. Please try again.
          </p>
        </div>
      )}

      {/* Completed - Pack Content */}
      {pack.status === 'completed' && pack.packJson && (
        <div className="space-y-6">
          {/* Relevant Cases */}
          {pack.packJson.cases.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Relevant Cases ({pack.packJson.cases.length})
              </h2>
              <div className="mt-2 space-y-3">
                {pack.packJson.cases.map((c, i) => (
                  <CaseCard key={i} caseItem={c} />
                ))}
              </div>
            </section>
          )}

          {/* Relevant Provisions */}
          {pack.packJson.provisions.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Relevant Provisions ({pack.packJson.provisions.length})
              </h2>
              <div className="mt-2 space-y-3">
                {pack.packJson.provisions.map((p, i) => (
                  <ProvisionCard key={i} provision={p} />
                ))}
              </div>
            </section>
          )}

          {/* Arguments */}
          {pack.packJson.arguments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Arguments ({pack.packJson.arguments.length})
              </h2>
              <div className="mt-2 space-y-3">
                {pack.packJson.arguments.map((a, i) => (
                  <ArgumentCard key={i} argument={a} type="argument" />
                ))}
              </div>
            </section>
          )}

          {/* Counter-Arguments */}
          {pack.packJson.counterArguments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Counter-Arguments ({pack.packJson.counterArguments.length})
              </h2>
              <div className="mt-2 space-y-3">
                {pack.packJson.counterArguments.map((a, i) => (
                  <ArgumentCard key={i} argument={a} type="counter" />
                ))}
              </div>
            </section>
          )}

          {/* Suggested Questions */}
          {pack.packJson.suggestedQuestions.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Suggested Questions ({pack.packJson.suggestedQuestions.length})
              </h2>
              <ul className="mt-2 space-y-2">
                {pack.packJson.suggestedQuestions.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-md border bg-yellow-50 p-3 text-sm text-yellow-900"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function CaseCard({ caseItem }: { caseItem: HearingPrepCase }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{caseItem.title}</p>
          {caseItem.citationText && (
            <p className="text-xs text-gray-500">{caseItem.citationText}</p>
          )}
        </div>
        {caseItem.documentId && (
          <Link
            href={`/reader/${caseItem.documentId}`}
            className="shrink-0 text-xs text-blue-600 hover:underline"
          >
            View
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm text-gray-600">{caseItem.relevance}</p>
      {caseItem.keyHoldings.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-gray-500">Key Holdings:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-gray-600">
            {caseItem.keyHoldings.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProvisionCard({ provision }: { provision: HearingPrepProvision }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {provision.title}
          </p>
          {provision.sectionLabel && (
            <p className="text-xs text-gray-500">{provision.sectionLabel}</p>
          )}
        </div>
        {provision.documentId && (
          <Link
            href={`/reader/${provision.documentId}`}
            className="shrink-0 text-xs text-blue-600 hover:underline"
          >
            View
          </Link>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm italic text-gray-600">
        {provision.text}
      </p>
      <p className="mt-1 text-xs text-gray-500">{provision.relevance}</p>
    </div>
  );
}

function ArgumentCard({
  argument,
  type,
}: {
  argument: HearingPrepArgument;
  type: 'argument' | 'counter';
}) {
  const strengthStyle =
    ARGUMENT_STRENGTH_COLORS[argument.strength] ??
    'bg-gray-100 text-gray-700';
  const strengthLabel =
    ARGUMENT_STRENGTH_LABELS[argument.strength] ?? argument.strength;

  return (
    <div
      className={`rounded-md border p-3 ${
        type === 'counter' ? 'border-orange-200 bg-orange-50' : 'bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">
          {argument.position}
        </p>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${strengthStyle}`}
        >
          {strengthLabel}
        </span>
      </div>
      {argument.supportingCases.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-gray-500">Supporting Cases:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {argument.supportingCases.map((c, i) => (
              <span
                key={i}
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
      {argument.supportingProvisions.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-gray-500">
            Supporting Provisions:
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {argument.supportingProvisions.map((p, i) => (
              <span
                key={i}
                className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
