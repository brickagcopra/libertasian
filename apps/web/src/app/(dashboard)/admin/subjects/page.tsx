'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

import {
  useSubjects,
  useSubjectTopics,
  useClassificationCoverage,
  useClassifyUnclassified,
} from '@/features/admin/hooks/use-subjects';
import type { SubjectItem } from '@/features/admin/hooks/use-subjects';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const TAXONOMY_TABS = [
  { value: 'study_8', label: 'Study 8' },
  { value: 'bar_admin_6', label: 'Bar Admin 6' },
] as const;

function CoverageBar({ percent }: { percent: number }) {
  const barColor =
    percent >= 80
      ? 'bg-green-500'
      : percent >= 50
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{percent.toFixed(1)}%</span>
    </div>
  );
}

function ExpandableSubjectRow({
  subject,
  coverage,
}: {
  subject: SubjectItem;
  coverage?: {
    documentCount: number;
    primaryCount: number;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: topics } = useSubjectTopics(expanded ? subject.id : '');

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <div>
              <div className="font-medium">{subject.name}</div>
              <div className="text-xs text-muted-foreground">{subject.code}</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">{coverage?.documentCount ?? 0}</TableCell>
        <TableCell className="text-right">{coverage?.primaryCount ?? 0}</TableCell>
        <TableCell>
          {subject.weightPercent != null && (
            <span className="text-sm text-muted-foreground">
              {subject.weightPercent}%
            </span>
          )}
        </TableCell>
      </TableRow>
      {expanded && topics && topics.length > 0 && (
        <>
          {topics.map((topic) => (
            <TableRow key={topic.id} className="bg-muted/30">
              <TableCell className="pl-12">
                <div>
                  <div className="text-sm">{topic.name}</div>
                  <div className="text-xs text-muted-foreground">{topic.code}</div>
                </div>
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
            </TableRow>
          ))}
        </>
      )}
    </>
  );
}

export default function SubjectsPage() {
  const [taxonomy, setTaxonomy] = useState<string>('study_8');

  const { data: subjects, isLoading: subjectsLoading } = useSubjects(taxonomy);
  const { data: coverage, isLoading: coverageLoading } = useClassificationCoverage();
  const classifyMutation = useClassifyUnclassified();

  const handleClassifyUnclassified = () => {
    classifyMutation.mutate();
  };

  // Build coverage lookup by subjectId
  const coverageBySubject = new Map(
    (coverage?.bySubject ?? []).map((s) => [s.subjectId, s]),
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="text-2xl font-bold">Subject Taxonomy</h1>
        </div>
        <Button
          onClick={handleClassifyUnclassified}
          disabled={classifyMutation.isPending || (coverage?.unclassifiedDocuments ?? 0) === 0}
        >
          <RefreshCw
            className={`mr-2 size-4 ${classifyMutation.isPending ? 'animate-spin' : ''}`}
          />
          {classifyMutation.isPending ? 'Classifying...' : 'Classify Unclassified'}
        </Button>
      </div>

      {/* Coverage Stats */}
      {coverageLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : coverage ? (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{coverage.totalDocuments.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Classified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {coverage.classifiedDocuments.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Unclassified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  coverage.unclassifiedDocuments > 0 ? 'text-red-600' : 'text-muted-foreground'
                }`}
              >
                {coverage.unclassifiedDocuments.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{coverage.coveragePercent}%</div>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full transition-all ${
                    coverage.coveragePercent >= 80
                      ? 'bg-green-500'
                      : coverage.coveragePercent >= 50
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(coverage.coveragePercent, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Taxonomy Tabs + Subject Table */}
      <Tabs value={taxonomy} onValueChange={setTaxonomy}>
        <TabsList>
          {TAXONOMY_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAXONOMY_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {subjectsLoading ? (
              <AdminListSkeleton count={8} />
            ) : subjects && subjects.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead className="text-right">Primary</TableHead>
                      <TableHead>Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subjects.map((subject) => (
                      <ExpandableSubjectRow
                        key={subject.id}
                        subject={subject}
                        coverage={coverageBySubject.get(subject.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    No subjects found for {tab.label} taxonomy.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Equivalence Map (read-only) */}
      {taxonomy === 'study_8' && coverage && (
        <Card>
          <CardHeader>
            <CardTitle>Subject Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {coverage.bySubject.length > 0 ? (
              <div className="space-y-3">
                {coverage.bySubject.map((s) => (
                  <div key={s.subjectId} className="flex items-center gap-3">
                    <div className="w-40 truncate text-sm font-medium">{s.subjectCode}</div>
                    <CoverageBar
                      percent={
                        coverage.totalDocuments > 0
                          ? (s.documentCount / coverage.totalDocuments) * 100
                          : 0
                      }
                    />
                    <Badge variant="outline" className="ml-auto">
                      {s.documentCount} docs
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No classification data yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
