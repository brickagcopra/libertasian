'use client';

import { cn } from '@/lib/utils';

const FILTER_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'case_digest', label: 'Digests' },
  { value: 'doctrine_extract', label: 'Doctrines' },
  { value: 'mcq_question', label: 'MCQs' },
  { value: 'essay_prompt', label: 'Essays' },
  { value: 'subject_outline', label: 'Outlines' },
  { value: 'flashcard', label: 'Flashcards' },
];

interface DerivativeTypeFilterProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

export function DerivativeTypeFilter({ value, onChange }: DerivativeTypeFilterProps) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
      {FILTER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md px-3 py-1 text-sm transition',
              active
                ? 'bg-background shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-background/50',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
