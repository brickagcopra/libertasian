'use client';

import Link from 'next/link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import {
  AlertCircleIcon,
  FileTextIcon,
  LoaderIcon,
  ShieldAlertIcon,
} from 'lucide-react';

import { useAiAnswerStream } from '../hooks/use-ai-answer-stream';
import { abstentionCopy } from './abstention-copy';

interface AiSummaryResultsProps {
  query: string | null;
}

export function AiSummaryResults({ query }: AiSummaryResultsProps) {
  const {
    text,
    sources,
    isStreaming,
    isDone,
    error,
    confidence,
    abstained,
    abstentionReason,
  } = useAiAnswerStream(query, !!query);

  // Idle state — no query yet
  if (!query) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Enter a search query to get an AI-generated answer.
      </p>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // Loading state (before any text arrives)
  if (isStreaming && !text) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
          Generating AI answer...
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/6" />
        </div>
      </div>
    );
  }

  // Abstention state
  if (isDone && abstained) {
    return (
      <Alert>
        <ShieldAlertIcon className="size-4" />
        <AlertDescription>{abstentionCopy(abstentionReason)}</AlertDescription>
      </Alert>
    );
  }

  // No text at all and not streaming — shouldn't happen normally but handle gracefully
  if (!text && !isStreaming) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Answer text */}
      <Card>
        <CardContent className="p-4">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <p className="whitespace-pre-wrap">{text}</p>
            {isStreaming && (
              <span className="inline-block h-4 w-1 animate-pulse bg-foreground" />
            )}
          </div>
          {isDone && confidence !== null && (
            <div className="mt-4 flex items-center gap-2">
              <ConfidenceBadge confidence={confidence} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sources */}
      {sources.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4" />
              Sources ({sources.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {sources.map((source, i) => (
              <div
                key={source.section_id ?? source.document_id + i}
                className="rounded-md border p-3"
              >
                <Link
                  href={ROUTES.READER(source.document_id)}
                  className="text-sm font-medium hover:underline"
                >
                  {source.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {source.citation_text && (
                    <span className="text-xs text-muted-foreground">
                      {source.citation_text}
                    </span>
                  )}
                  {source.gr_no && (
                    <span className="text-xs text-muted-foreground">
                      {source.gr_no}
                    </span>
                  )}
                  {source.court && (
                    <span className="text-xs text-muted-foreground">
                      {source.court.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {source.passage_text && (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {source.passage_text}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
        High confidence ({Math.round(confidence * 100)}%)
      </Badge>
    );
  }
  if (confidence >= 0.5) {
    return (
      <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-700">
        Moderate confidence ({Math.round(confidence * 100)}%)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
      Low confidence ({Math.round(confidence * 100)}%)
    </Badge>
  );
}
