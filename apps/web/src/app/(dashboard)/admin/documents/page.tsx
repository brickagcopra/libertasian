'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileStackIcon } from 'lucide-react';

import {
  useAdminDocuments,
  type AdminDocumentListItem,
} from '@/features/admin/hooks/use-admin-documents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TAB_VALUES = ['all', 'published', 'draft', 'unpublished', 'archived'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_LABELS: Record<TabValue, string> = {
  all: 'All',
  published: 'Published',
  draft: 'Draft',
  unpublished: 'Unpublished',
  archived: 'Archived',
};

const DOCUMENT_TYPES = [
  { value: '__all__', label: 'All types' },
  { value: 'case', label: 'Case' },
  { value: 'statute', label: 'Statute' },
  { value: 'rule', label: 'Rule' },
  { value: 'issuance', label: 'Issuance' },
  { value: 'memorandum', label: 'Memorandum' },
  { value: 'order', label: 'Order' },
  { value: 'digest', label: 'Digest' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'user_private_doc', label: 'User private' },
];

const STATUS_VARIANT: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-muted text-muted-foreground',
  unpublished: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-red-100 text-red-700',
};

const TYPE_VARIANT = 'bg-blue-50 text-blue-700';

export default function AdminDocumentsListPage() {
  const [tab, setTab] = useState<TabValue>('all');
  const [documentType, setDocumentType] = useState<string>('__all__');
  const [court, setCourt] = useState<string>('');
  const [grNo, setGrNo] = useState<string>('');
  const [sourceQuery, setSourceQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // Debounced inputs (court, grNo) — apply 250ms after user stops typing.
  const [debouncedCourt, setDebouncedCourt] = useState(court);
  const [debouncedGrNo, setDebouncedGrNo] = useState(grNo);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCourt(court), 250);
    return () => clearTimeout(t);
  }, [court]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedGrNo(grNo), 250);
    return () => clearTimeout(t);
  }, [grNo]);

  const status = tab === 'all' ? undefined : tab;
  const queryParams = {
    status,
    documentType: documentType === '__all__' ? undefined : documentType,
    court: debouncedCourt || undefined,
    grNo: debouncedGrNo || undefined,
    // sourceId is a UUID — only forward when the user has typed a UUID-shaped string
    sourceId: isUuid(sourceQuery) ? sourceQuery : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    cursor,
    limit: 20,
  };

  const { data, isLoading, error } = useAdminDocuments(queryParams);

  const handleTabChange = (val: string) => {
    if ((TAB_VALUES as readonly string[]).includes(val)) {
      setTab(val as TabValue);
      setCursor(undefined);
    }
  };

  const hasActiveFilter =
    documentType !== '__all__' ||
    !!court ||
    !!grNo ||
    !!sourceQuery ||
    !!dateFrom ||
    !!dateTo;

  const clearFilters = () => {
    setDocumentType('__all__');
    setCourt('');
    setGrNo('');
    setSourceQuery('');
    setDateFrom('');
    setDateTo('');
    setCursor(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Legal Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the corpus, filter by status, and drill into a document to publish or quarantine.
          </p>
        </div>
        <Button variant="outline" asChild className="self-start sm:self-auto">
          <Link href="/admin/ingestion" aria-label="Open ingestion pipeline">
            Open ingestion pipeline
            <ArrowRight className="ml-1.5 size-4" />
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="flex flex-wrap">
          {TAB_VALUES.map((v) => (
            <TabsTrigger key={v} value={v}>
              {TAB_LABELS[v]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="filter-doctype" className="text-xs">
            Type
          </Label>
          <Select
            value={documentType}
            onValueChange={(val) => {
              setDocumentType(val);
              setCursor(undefined);
            }}
          >
            <SelectTrigger id="filter-doctype" className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-court" className="text-xs">
            Court
          </Label>
          <Input
            id="filter-court"
            value={court}
            onChange={(e) => {
              setCourt(e.target.value);
              setCursor(undefined);
            }}
            placeholder="e.g. Supreme Court"
            className="h-9 w-[180px]"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-grno" className="text-xs">
            G.R. No.
          </Label>
          <Input
            id="filter-grno"
            value={grNo}
            onChange={(e) => {
              setGrNo(e.target.value);
              setCursor(undefined);
            }}
            placeholder="e.g. 12345"
            className="h-9 w-[140px]"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-source" className="text-xs">
            Source ID
          </Label>
          <Input
            id="filter-source"
            value={sourceQuery}
            onChange={(e) => {
              setSourceQuery(e.target.value);
              setCursor(undefined);
            }}
            placeholder="UUID"
            className="h-9 w-[180px] font-mono text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-from" className="text-xs">
            Decision from
          </Label>
          <Input
            id="filter-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setCursor(undefined);
            }}
            className="h-9 w-[150px]"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-to" className="text-xs">
            Decision to
          </Label>
          <Input
            id="filter-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setCursor(undefined);
            }}
            className="h-9 w-[150px]"
          />
        </div>

        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9"
          >
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load documents'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Citation</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Court</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} />
                ))}
              </tbody>
            </table>
          </div>
          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor)}
              >
                Next page
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: AdminDocumentListItem }) {
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-2 align-top">
        <Link
          href={`/admin/documents/${doc.id}`}
          className="font-medium hover:underline"
        >
          {doc.title}
        </Link>
      </td>
      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
        {doc.citationText ?? doc.grNo ?? '—'}
      </td>
      <td className="px-3 py-2 align-top">
        <Badge className={TYPE_VARIANT}>{doc.documentType.replace(/_/g, ' ')}</Badge>
      </td>
      <td className="px-3 py-2 align-top">
        <Badge
          className={STATUS_VARIANT[doc.status] ?? 'bg-muted text-muted-foreground'}
          aria-label={`Status: ${doc.status}`}
        >
          {doc.status}
        </Badge>
      </td>
      <td className="px-3 py-2 align-top text-xs">{doc.court ?? '—'}</td>
      <td className="px-3 py-2 align-top text-xs">
        {doc.decisionDate ? formatRelative(doc.decisionDate) : '—'}
      </td>
      <td className="px-3 py-2 align-top text-xs">{formatRelative(doc.createdAt)}</td>
      <td className="px-3 py-2 align-top">
        <Button variant="outline" size="sm" asChild>
          <Link
            href={`/admin/documents/${doc.id}`}
            aria-label={`View document ${doc.title}`}
          >
            View
          </Link>
        </Button>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <FileStackIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">No documents match this view</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different status tab, adjust filters, or feed the corpus from ingestion.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/ingestion">Open ingestion pipeline</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/backfill">Trigger backfill</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 86400 * 365)
    return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}
