'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { useCodals, type CodalTabGroup } from '@/features/study/hooks/use-codals';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchIcon, AlertCircleIcon } from 'lucide-react';

const DEFAULT_TAB: CodalTabGroup = 'statutes';

const EMPTY_COPY: Record<CodalTabGroup, (subjectLabel: string) => string> = {
  constitutions: (s) => `No constitutional documents yet for ${s}.`,
  statutes: (s) => `No statutes yet for ${s}.`,
  executive_issuances: () =>
    'Executive issuances are not yet in the library. Coming soon.',
  rules: (s) => `No rules yet for ${s}.`,
};

export default function CodalSubjectPage() {
  const params = useParams();
  const subject = params['subject'] as string;
  const [tabGroup, setTabGroup] = useState<CodalTabGroup>(DEFAULT_TAB);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, error } = useCodals(subject, {
    tabGroup,
    search: search || undefined,
  });

  const codals = data?.data ?? [];
  const meta = data?.meta;

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearch(searchInput);
    },
    [searchInput],
  );

  const subjectLabel = subject.replace(/_/g, ' ');

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={ROUTES.STUDY} className="hover:text-foreground">
            Study
          </Link>
          <span>&gt;</span>
          <Link href={ROUTES.STUDY_CODALS} className="hover:text-foreground">
            Codals
          </Link>
          <span>&gt;</span>
          <span className="capitalize text-foreground">{subjectLabel}</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold capitalize">{subjectLabel}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codals and statutes for this bar subject area
        </p>
      </div>

      <Tabs
        value={tabGroup}
        onValueChange={(value) => setTabGroup(value as CodalTabGroup)}
      >
        <TabsList>
          <TabsTrigger value="statutes">Statutes</TabsTrigger>
          <TabsTrigger value="constitutions">Constitutions</TabsTrigger>
          <TabsTrigger value="executive_issuances">Executive Issuances</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            type="text"
            placeholder="Search by title..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="outline">
            <SearchIcon className="mr-2 size-4" />
            Search
          </Button>
        </form>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load codals: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && codals.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {search
            ? `No codals found matching "${search}" in ${tabGroup.replace(/_/g, ' ')}.`
            : EMPTY_COPY[tabGroup](subjectLabel)}
        </p>
      )}

      <div className="space-y-2">
        {codals.map((codal) => (
          <Link key={codal.id} href={ROUTES.READER(codal.id)}>
            <Card className="transition hover:shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{codal.title}</p>
                    {codal.shortTitle && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{codal.shortTitle}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/60">
                      <Badge variant="secondary" className="capitalize">
                        {codal.documentType.replace(/_/g, ' ')}
                      </Badge>
                      {codal.citationText && <span>{codal.citationText}</span>}
                      {codal.promulgationDate && (
                        <span>{new Date(codal.promulgationDate).toLocaleDateString()}</span>
                      )}
                      {codal.sectionCount > 0 && (
                        <span>
                          {codal.sectionCount} section{codal.sectionCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {codal.isOfficial && (
                        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                          Official
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {meta?.hasNext && (
        <p className="text-center text-sm text-muted-foreground/70">
          More codals available. Pagination coming soon.
        </p>
      )}
    </div>
  );
}
