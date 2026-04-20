'use client';

import { cn } from '@/lib/utils';

import type { DerivativeSubjectSummary } from '../types';

interface SubjectChipsProps {
  subjects: DerivativeSubjectSummary[];
  activeCode: string | null;
  onChange: (code: string | null) => void;
  isLoading?: boolean;
}

export function SubjectChips({ subjects, activeCode, onChange, isLoading }: SubjectChipsProps) {
  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'rounded-full border px-3 py-1.5 text-sm transition',
          activeCode === null
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background hover:bg-muted',
        )}
      >
        All
      </button>
      {subjects.map((s) => {
        const active = activeCode === s.code;
        return (
          <button
            key={s.code}
            type="button"
            onClick={() => onChange(active ? null : s.code)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {s.name}
            <span
              className={cn(
                'ml-2 rounded-full px-1.5 py-0.5 text-xs',
                active ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
              )}
            >
              {s.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
