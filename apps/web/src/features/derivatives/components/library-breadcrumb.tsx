import Link from 'next/link';

import { ChevronRightIcon } from 'lucide-react';

export interface BreadcrumbSegment {
  href?: string;
  label: string;
}

export function LibraryBreadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          return (
            <li key={`${seg.label}-${i}`} className="flex items-center gap-1">
              {seg.href && !last ? (
                <Link href={seg.href} className="hover:underline">
                  {seg.label}
                </Link>
              ) : (
                <span className={last ? 'text-foreground' : undefined}>{seg.label}</span>
              )}
              {!last && <ChevronRightIcon className="h-3.5 w-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
