'use client';

import Link from 'next/link';

import type { Digest } from '../hooks/use-digests';

const REVIEW_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ai_generated: 'bg-blue-100 text-blue-700',
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function DigestSection({ heading, content }: { heading: string; content: string | null | undefined }) {
  if (!content) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700">{heading}</h4>
      <p className="mt-1 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>{content}</p>
    </div>
  );
}

export function parseCitedAuthorities(json: unknown): string[] {
  if (!json) return [];
  try {
    const arr = Array.isArray(json) ? json : [];
    return arr
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'citationText' in item) {
          return String((item as { citationText: string }).citationText);
        }
        return null;
      })
      .filter((s): s is string => s !== null);
  } catch {
    return [];
  }
}

interface DigestContentPanelProps {
  digest: Digest;
  /** Cited authorities JSON blob — present on AdminDigestDetail but not base Digest. */
  citedAuthoritiesJson?: unknown;
  /** Hide document citation and title when already shown by the parent (e.g. reader page). */
  showHeader?: boolean;
  /** Link target for "View full digest". Defaults to /digests/:id. */
  detailHref?: string;
}

export function DigestContentPanel({
  digest,
  citedAuthoritiesJson,
  showHeader = true,
  detailHref,
}: DigestContentPanelProps) {
  const citedAuthorities = parseCitedAuthorities(citedAuthoritiesJson);
  const href = detailHref ?? `/digests/${digest.id}`;

  return (
    <div className="space-y-4">
      {showHeader && (
        <div>
          <h4 className="text-base font-semibold text-gray-900">{digest.title}</h4>
          {digest.legalDocument?.grNo && (
            <p className="text-xs text-gray-500">G.R. No. {digest.legalDocument.grNo}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {digest.confidenceScore !== null && (
              <span className="text-xs text-gray-500">
                Confidence: {(digest.confidenceScore * 100).toFixed(0)}%
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_COLORS[digest.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {digest.reviewStatus}
            </span>
          </div>
        </div>
      )}

      <DigestSection heading="Summary" content={digest.summary} />
      <DigestSection heading="Facts" content={digest.facts} />
      <DigestSection heading="Petitioner Arguments" content={digest.petitionerArguments} />
      <DigestSection heading="Respondent Arguments" content={digest.respondentArguments} />
      <DigestSection heading="Issues" content={digest.issues} />
      <DigestSection heading="Ruling" content={digest.ruling} />
      <DigestSection heading="Doctrine" content={digest.doctrine} />

      {digest.dispositive && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3">
          <h4 className="text-sm font-semibold text-blue-800">Dispositive</h4>
          <p className="mt-1 text-sm text-blue-900" style={{ whiteSpace: 'pre-line' }}>
            {digest.dispositive}
          </p>
        </div>
      )}

      {citedAuthorities.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700">Cited Authorities</h4>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-800">
            {citedAuthorities.map((cite, i) => (
              <li key={i}>{cite}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-2">
        <Link
          href={href}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          View full digest &rarr;
        </Link>
      </div>
    </div>
  );
}
