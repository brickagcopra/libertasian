'use client';

import { FileTextIcon } from 'lucide-react';

import { useDigests, useGenerateDigest } from '@/features/digests/hooks/use-digests';
import { sanitizeRulingText } from '@/features/digests/lib/sanitize-ruling';
import { ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';

interface AiSummaryTabProps {
  documentId: string;
}

export function AiSummaryTab({ documentId }: AiSummaryTabProps) {
  const { data: digestsData, isLoading } = useDigests({ legalDocumentId: documentId });
  const generateDigest = useGenerateDigest();
  const [errorMsg, setErrorMsg] = useState('');

  const firstDigest = digestsData?.data?.[0];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading summary...
        </CardContent>
      </Card>
    );
  }

  if (!firstDigest) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <FileTextIcon className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No AI summary available for this document.
          </p>
          <Button
            onClick={async () => {
              try {
                setErrorMsg('');
                await generateDigest.mutateAsync({ legalDocumentId: documentId });
              } catch (error) {
                if (error instanceof ApiClientError) {
                  setErrorMsg(error.message);
                } else {
                  setErrorMsg('Failed to generate summary');
                }
              }
            }}
            disabled={generateDigest.isPending}
          >
            <FileTextIcon className="mr-1.5 h-4 w-4" />
            {generateDigest.isPending ? 'Generating...' : 'Generate AI Summary'}
          </Button>
          {errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">AI Summary</CardTitle>
            <div className="flex items-center gap-2">
              {firstDigest.confidenceScore != null && (
                <Badge variant="secondary">
                  Confidence: {Math.round(firstDigest.confidenceScore * 100)}%
                </Badge>
              )}
              <Badge variant="outline">{firstDigest.reviewStatus}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {firstDigest.summary && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Summary</h3>
              <p className="text-sm leading-relaxed">{firstDigest.summary}</p>
            </div>
          )}
          {firstDigest.facts && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Facts</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{firstDigest.facts}</p>
            </div>
          )}
          {firstDigest.issues && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Issues</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{firstDigest.issues}</p>
            </div>
          )}
          {firstDigest.ruling && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Ruling</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{sanitizeRulingText(firstDigest.ruling)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
