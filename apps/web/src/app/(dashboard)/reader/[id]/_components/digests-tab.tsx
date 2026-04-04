'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileTextIcon } from 'lucide-react';

import { useDigests } from '@/features/digests/hooks/use-digests';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface DigestsTabProps {
  documentId: string;
}

const DIGEST_FIELDS = [
  { key: 'facts', label: 'Facts' },
  { key: 'issues', label: 'Issues' },
  { key: 'ruling', label: 'Ruling' },
  { key: 'doctrine', label: 'Doctrine' },
  { key: 'dispositive', label: 'Dispositive' },
  { key: 'petitionerArguments', label: 'Petitioner Arguments' },
  { key: 'respondentArguments', label: 'Respondent Arguments' },
] as const;

export function DigestsTab({ documentId }: DigestsTabProps) {
  const { data: digestsData, isLoading } = useDigests({ legalDocumentId: documentId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading digests...
        </CardContent>
      </Card>
    );
  }

  const digests = digestsData?.data ?? [];

  if (digests.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <FileTextIcon className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No digests available for this document.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {digests.map((digest) => (
        <DigestCard key={digest.id} digest={digest} />
      ))}
    </div>
  );
}

function DigestCard({ digest }: { digest: Record<string, unknown> }) {
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const toggleField = (key: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {(digest.title as string) || 'Digest'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {digest.digestType && (
              <Badge variant="outline">{digest.digestType as string}</Badge>
            )}
            {digest.confidenceScore != null && (
              <Badge variant="secondary">
                {Math.round((digest.confidenceScore as number) * 100)}%
              </Badge>
            )}
            {digest.reviewStatus && (
              <Badge
                variant={
                  digest.reviewStatus === 'approved'
                    ? 'default'
                    : 'secondary'
                }
              >
                {digest.reviewStatus as string}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {digest.summary && (
          <p className="text-sm text-muted-foreground">
            {digest.summary as string}
          </p>
        )}

        {DIGEST_FIELDS.map(({ key, label }) => {
          const value = digest[key] as string | undefined;
          if (!value) return null;

          const isExpanded = expandedFields.has(key);

          return (
            <div key={key} className="border-t pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start p-1 text-sm font-medium"
                onClick={() => toggleField(key)}
              >
                {isExpanded ? (
                  <ChevronDown className="mr-1 h-3 w-3" />
                ) : (
                  <ChevronRight className="mr-1 h-3 w-3" />
                )}
                {label}
              </Button>
              {isExpanded && (
                <p className="mt-1 whitespace-pre-wrap pl-5 text-sm leading-relaxed">
                  {value}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
