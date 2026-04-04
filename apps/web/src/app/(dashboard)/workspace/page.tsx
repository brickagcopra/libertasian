'use client';

import Link from 'next/link';
import { Trash2Icon, BookmarkXIcon } from 'lucide-react';

import { useBookmarks, useDeleteBookmark } from '@/features/bookmarks/hooks/use-bookmarks';
import { ActivityFeed } from '@/features/workspace/components/activity-feed';
import { BookmarkListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WorkspacePage() {
  const { data, isLoading, error } = useBookmarks();
  const deleteBookmark = useDeleteBookmark();

  const bookmarks = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your bookmarks and recent team activity</p>
      </div>

      {/* Recent Activity Widget */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed limit={5} />
        </CardContent>
      </Card>

      {/* Bookmarks Section */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Bookmarks</h2>
      </div>

      {isLoading && <BookmarkListSkeleton />}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load bookmarks: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && bookmarks.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <BookmarkXIcon className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No bookmarks yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bookmark documents from the{' '}
              <Link href={ROUTES.SEARCH} className="underline">
                search page
              </Link>{' '}
              to save them here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {bookmarks.map((bookmark) => (
          <Card key={bookmark.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                {bookmark.legalDocument ? (
                  <Link
                    href={ROUTES.READER(bookmark.legalDocument.id)}
                    className="text-sm font-medium hover:underline"
                  >
                    {bookmark.legalDocument.title}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">Document unavailable</span>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {bookmark.legalDocument?.documentType && (
                    <Badge variant="secondary" className="capitalize text-xs">
                      {bookmark.legalDocument.documentType.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {bookmark.legalDocument?.grNo && (
                    <span>{bookmark.legalDocument.grNo}</span>
                  )}
                  <span>Bookmarked {new Date(bookmark.createdAt).toLocaleDateString()}</span>
                </div>
                {bookmark.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{bookmark.note}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-4 shrink-0 text-destructive hover:text-destructive"
                onClick={() => deleteBookmark.mutate(bookmark.id)}
                disabled={deleteBookmark.isPending}
              >
                <Trash2Icon className="mr-1 h-3.5 w-3.5" />
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
