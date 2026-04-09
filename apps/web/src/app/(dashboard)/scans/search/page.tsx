'use client';

import { useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import Link from 'next/link';
import { ArrowLeft, SearchIcon } from 'lucide-react';

import { useUploadSearch } from '@/features/scans/hooks/use-upload-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function UploadSearchPage() {
  const [queryInput, setQueryInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const { data: results, isLoading, error } = useUploadSearch(
    searchQuery ? { query: searchQuery, page, limit: 20 } : null,
  );

  const handleSearch = useCallback(() => {
    if (queryInput.trim()) {
      setSearchQuery(queryInput.trim());
      setPage(1);
    }
  }, [queryInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  const totalPages = results ? Math.ceil(results.total / results.limit) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Search Uploads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full-text search across your OCR-processed uploads
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/scans">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Scans
          </Link>
        </Button>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <Input
          placeholder="Search your uploaded documents..."
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={!queryInput.trim() || isLoading}>
          <SearchIcon className="mr-1.5 h-4 w-4" />
          Search
        </Button>
      </div>

      {/* Results */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Search failed. Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[100px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {results && !isLoading && (
        <>
          <p className="text-sm text-muted-foreground">
            {results.total} result{results.total !== 1 ? 's' : ''} found
            {results.timedOut && ' (search timed out — showing partial results)'}
          </p>

          {results.items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <SearchIcon className="size-12 text-muted-foreground/50" />
                <h3 className="mt-3 text-sm font-semibold">No results found</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try different search terms or upload more documents.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.items.map((item) => (
                <Link key={item.id} href={`/scans/${item.source.upload_id}`}>
                  <Card className="transition-colors hover:border-border/80">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {item.source.original_filename ?? `Upload ${item.source.upload_id.slice(0, 8)}`}
                          </p>
                          <div className="mt-1 flex gap-2">
                            {item.source.classified_document_type && (
                              <Badge variant="secondary">
                                {item.source.classified_document_type.replace(/_/g, ' ')}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {item.source.upload_type.replace(/_/g, ' ')}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(item.source.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {item.score.toFixed(2)}
                        </span>
                      </div>

                      {/* Highlighted OCR text snippets */}
                      {item.highlights?.['ocr_text'] && (
                        <div className="mt-2 space-y-1">
                          {item.highlights['ocr_text'].map((snippet, idx) => (
                            <p
                              key={idx}
                              className="line-clamp-2 text-xs text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(snippet, { ALLOWED_TAGS: ['mark', 'em', 'strong', 'b'] }) }}
                            />
                          ))}
                        </div>
                      )}

                      {item.source.extracted_citations && item.source.extracted_citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.source.extracted_citations.slice(0, 5).map((cit, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {cit}
                            </Badge>
                          ))}
                          {item.source.extracted_citations.length > 5 && (
                            <span className="text-xs text-muted-foreground">
                              +{item.source.extracted_citations.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
