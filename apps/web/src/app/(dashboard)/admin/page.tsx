'use client';

import Link from 'next/link';

import { useCorpusHealth } from '@/features/admin/hooks/use-admin';
import { AdminCardSkeleton } from '@/components/ui/skeleton';

export default function AdminDashboardPage() {
  const { data: health, isLoading, error } = useCorpusHealth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Corpus health, source status, and editorial overview</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Failed to load corpus health'}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : health ? (
        <>
          {/* Corpus Stats */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Corpus Overview</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Documents" value={health.corpus.total} />
              <StatCard label="Published" value={health.corpus.published} />
              <StatCard label="Drafts" value={health.corpus.draft} />
              <StatCard label="Needs Review" value={health.corpus.needsReview} accent="yellow" />
              <StatCard label="Quarantined" value={health.corpus.quarantined} accent="red" />
              <StatCard label="Pending Digests" value={health.reviewQueue.pendingDigests} accent="yellow" />
              <StatCard label="Open Flags" value={health.reviewQueue.openFlags} accent="red" />
            </div>
          </div>

          {/* Documents by Type */}
          {health.documentsByType.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Documents by Type</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {health.documentsByType.map((dt) => (
                  <StatCard key={dt.type} label={formatDocType(dt.type)} value={dt.count} />
                ))}
              </div>
            </div>
          )}

          {/* Source Health */}
          {health.sources.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Source Health</h2>
              <div className="divide-y rounded-md border border-gray-200 bg-white">
                {health.sources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{source.name}</p>
                      <div className="mt-1 flex gap-2">
                        <TypeBadge type={source.type} />
                        <TrustBadge level={source.trustLevel} />
                        <span className="text-xs text-gray-500">
                          {source.documentCount} docs
                        </span>
                      </div>
                    </div>
                    <EndpointStatus endpoints={source.endpoints} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Links */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Quick Links</h2>
            <div className="flex flex-wrap gap-3">
              <QuickLink href="/admin/sources" label="Manage Sources" />
              <QuickLink href="/admin/review" label="Review Queue" count={health.reviewQueue.pendingDigests} />
              <QuickLink href="/admin/flags" label="Editorial Flags" count={health.reviewQueue.openFlags} />
              <QuickLink href="/admin/health" label="Source Health" />
              <QuickLink href="/admin/duplicates" label="Duplicates" />
              <QuickLink href="/admin/categorize" label="Categorize Bar Subjects" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- Sub-components ----

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'yellow' | 'red';
}) {
  const valueColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'yellow'
        ? 'text-yellow-600'
        : 'text-gray-900';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    official: 'bg-green-100 text-green-700',
    semi_official: 'bg-blue-100 text-blue-700',
    editorial: 'bg-purple-100 text-purple-700',
    user_upload: 'bg-gray-100 text-gray-700',
    camera_capture: 'bg-orange-100 text-orange-700',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

function TrustBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${colors[level] ?? 'bg-gray-100 text-gray-600'}`}>
      {level} trust
    </span>
  );
}

function EndpointStatus({
  endpoints,
}: {
  endpoints: Array<{ status: string; lastFetchedAt: string | null; lastSuccessAt: string | null }>;
}) {
  if (endpoints.length === 0) {
    return <span className="text-xs text-gray-400">No endpoints</span>;
  }

  const active = endpoints.filter((e) => e.status === 'active').length;
  return (
    <span className="text-xs text-gray-500">
      {active}/{endpoints.length} active
    </span>
  );
}

function QuickLink({ href, label, count }: { href: string; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
          {count}
        </span>
      )}
    </Link>
  );
}

function formatDocType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
