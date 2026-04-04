import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export function SearchResultSkeleton() {
  return (
    <div className="rounded-md border border bg-card p-4">
      <Skeleton className="h-4 w-3/4" />
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-1 h-3 w-5/6" />
    </div>
  );
}

export function SearchResultListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SearchResultSkeleton key={i} />
      ))}
    </div>
  );
}

export function DigestListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border bg-card p-4">
          <Skeleton className="h-4 w-2/3" />
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function BookmarkListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between rounded-md border border bg-card p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
    </div>
  );
}

export function AdminCardSkeleton() {
  return (
    <div className="rounded-md border border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

export function AdminListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MatterListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border bg-card p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NoteListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border bg-card p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <div className="flex gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MatterDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="border-b pb-4">
        <Skeleton className="h-6 w-2/3" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="mt-2 h-3 w-3/4" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border border bg-card p-4">
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReaderSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="border-b pb-4">
        <Skeleton className="h-6 w-3/4" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-4 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-5/6" />
            <Skeleton className="mt-1 h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
