'use client';

import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SendIcon, TelescopeIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { QuotaUsageItem } from '@/features/billing/types';

import { useDeepResearchQuota } from '../hooks/use-deep-research-runs';

export const EXAMPLE_QUESTIONS = [
  'When is a warrantless arrest valid under Rule 113 of the Rules of Court?',
  'What are the requisites of psychological incapacity under Article 36 of the Family Code after Tan-Andal v. Andal?',
  'Can an employer dismiss an employee for loss of trust and confidence, and what must be proven?',
] as const;

const MIN_LENGTH = 3;
const MAX_LENGTH = 2000;

/** "12 of 100 left this month" — or null when there is nothing useful to say. */
export function quotaChipText(quota: QuotaUsageItem | null): string | null {
  if (!quota) return null;
  if (quota.limit === -1) return 'Unlimited this month';
  if (quota.limit <= 0) return null;
  const left = Math.max(0, quota.remaining);
  return `${left} of ${quota.limit} left this month`;
}

export function ResearchComposer({
  initialQuestion,
  onSubmit,
  disabled = false,
}: {
  initialQuestion: string;
  onSubmit: (question: string) => void;
  disabled?: boolean;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const { quota } = useDeepResearchQuota();
  const chip = quotaChipText(quota);
  const exhausted = !!quota && quota.limit > 0 && quota.remaining <= 0;

  // A new ?q= (follow-up, "Go deeper" from search) replaces the draft.
  useEffect(() => {
    setQuestion(initialQuestion);
  }, [initialQuestion]);

  const trimmed = question.trim();
  const canSubmit = !disabled && trimmed.length >= MIN_LENGTH && trimmed.length <= MAX_LENGTH;

  const submit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (canSubmit) onSubmit(trimmed);
    },
    [canSubmit, onSubmit, trimmed],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-4 sm:py-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-warm-accent-deep">
          <TelescopeIcon className="size-5" aria-hidden />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em]">
            Deep Research
          </span>
        </div>
        <h1 className="font-serif text-2xl font-semibold text-warm-ink sm:text-3xl">
          Ask a legal research question
        </h1>
        <p className="text-sm text-warm-ink-mid">
          Deep Research plans several searches, ranks the authorities, writes an answer and then
          checks every statement against a verbatim quote from its source.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="dr-question" className="sr-only">
          Research question
        </label>
        <textarea
          id="dr-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_LENGTH}
          rows={6}
          placeholder="e.g. What are the elements of estafa under Article 315 of the Revised Penal Code?"
          className="w-full resize-y rounded-xl border border-warm-ink/15 bg-warm-surface px-4 py-3 text-base leading-7 text-warm-ink shadow-sm outline-none transition placeholder:text-warm-ink-faint focus-visible:border-warm-accent focus-visible:ring-4 focus-visible:ring-warm-accent/15"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {chip && (
              <span
                data-testid="quota-chip"
                className={
                  exhausted
                    ? 'rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700'
                    : 'rounded-full bg-warm-cream-2 px-3 py-1 text-xs font-medium text-warm-ink-mid'
                }
              >
                {chip}
              </span>
            )}
            <span className="hidden text-xs text-warm-ink-faint sm:inline">Ctrl + Enter to run</span>
          </div>
          <Button type="submit" variant="pill" disabled={!canSubmit}>
            <SendIcon aria-hidden />
            Run research
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
          Try an example
        </p>
        <div className="grid gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuestion(q)}
              className="rounded-lg border border-warm-ink/10 bg-warm-surface px-4 py-3 text-left text-sm text-warm-ink-soft transition hover:border-warm-accent/40 hover:bg-warm-cream-3"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
