import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ROUTES } from '@/lib/constants';
import { ShieldCheckIcon } from 'lucide-react';

import type { SearchResultItem } from '../types';

export function SearchResultCard({ item }: { item: SearchResultItem }) {
  const { source, highlights } = item;
  const displayType = source.document_type?.replace(/_/g, ' ') ?? 'Document';
  const highlightSnippets =
    highlights?.plain_text ?? highlights?.section_text ?? [];

  return (
    <Card className="transition-colors hover:border-border/80">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href={ROUTES.READER(source.document_id)}
              className="text-sm font-semibold hover:underline"
            >
              {source.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="capitalize">
                {displayType}
              </Badge>
              {source.court && (
                <span className="text-xs text-muted-foreground">
                  {source.court.replace(/_/g, ' ')}
                </span>
              )}
              {source.gr_no && (
                <span className="text-xs text-muted-foreground">{source.gr_no}</span>
              )}
              {source.ponente && (
                <span className="text-xs text-muted-foreground">
                  Ponente: {source.ponente}
                </span>
              )}
              {source.decision_date && (
                <span className="text-xs text-muted-foreground">
                  {new Date(source.decision_date).toLocaleDateString()}
                </span>
              )}
            </div>
            {highlightSnippets.length > 0 && (
              <div className="mt-2 space-y-1">
                {highlightSnippets.slice(0, 2).map((snippet, i) => (
                  <p
                    key={i}
                    className="line-clamp-2 text-xs text-muted-foreground [&_mark]:bg-yellow-200 [&_mark]:font-medium"
                    dangerouslySetInnerHTML={{ __html: snippet }}
                  />
                ))}
              </div>
            )}
          </div>
          {source.is_official && (
            <Badge variant="outline" className="shrink-0 border-green-200 bg-green-50 text-green-700">
              <ShieldCheckIcon className="size-3" />
              Official
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
