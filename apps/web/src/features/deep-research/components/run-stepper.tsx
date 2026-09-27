'use client';

import { CheckIcon, LoaderIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { stageProgress, type StreamState } from '../lib/stream-reducer';
import type { DeepResearchStage } from '../schemas';

const STAGE_LABELS: Record<DeepResearchStage, string> = {
  planning: 'Planning',
  searching: 'Searching',
  ranking: 'Ranking',
  writing: 'Writing',
  verifying: 'Verifying',
};

const STAGE_HINTS: Record<DeepResearchStage, string> = {
  planning: 'Breaking your question into research queries',
  searching: 'Searching statutes, decisions and the codals',
  ranking: 'Ranking passages by relevance and authority',
  writing: 'Drafting an answer from the best passages',
  verifying: 'Checking every statement against its quoted source',
};

export function RunStepper({
  state,
}: {
  state: Pick<StreamState, 'status' | 'stageIndex' | 'result' | 'stageDetail' | 'subQueries'>;
}) {
  const steps = stageProgress(state);
  return (
    <ol aria-label="Research progress" className="space-y-0" data-testid="run-stepper">
      {steps.map(({ stage, state: s }, i) => (
        <li key={stage} className="relative flex gap-3 pb-5 last:pb-0" data-state={s}>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px',
                s === 'complete' ? 'bg-warm-accent' : 'bg-warm-ink/10',
              )}
            />
          )}
          <span
            className={cn(
              'relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
              s === 'complete' && 'border-warm-accent bg-warm-accent text-warm-cream',
              s === 'active' && 'border-warm-accent bg-warm-accent-soft text-warm-accent-deep',
              s === 'pending' && 'border-warm-ink/15 bg-warm-surface text-warm-ink-faint',
            )}
          >
            {s === 'complete' ? (
              <CheckIcon className="size-3.5" aria-hidden />
            ) : s === 'active' ? (
              <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              i + 1
            )}
          </span>
          <div className="min-w-0 pt-0.5">
            <p
              className={cn(
                'text-sm font-semibold',
                s === 'pending' ? 'text-warm-ink-faint' : 'text-warm-ink',
              )}
            >
              {STAGE_LABELS[stage]}
              {state.stageDetail[stage] && (
                <span className="ml-2 font-normal text-warm-ink-mid">
                  · {state.stageDetail[stage]}
                </span>
              )}
              <span className="sr-only">
                {s === 'complete' ? ' (done)' : s === 'active' ? ' (in progress)' : ''}
              </span>
            </p>
            {s === 'active' && (
              <p className="mt-0.5 text-xs text-warm-ink-mid">{STAGE_HINTS[stage]}</p>
            )}
            {stage === 'searching' && state.subQueries.length > 0 && s !== 'pending' && (
              <ul className="mt-2 space-y-1" data-testid="sub-queries">
                {state.subQueries.map((q) => (
                  <li
                    key={q}
                    className="rounded-md border border-warm-ink/10 bg-warm-cream-2 px-2.5 py-1.5 text-xs text-warm-ink-soft"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
