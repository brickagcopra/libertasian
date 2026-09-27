'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HistoryIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

import { useDeepResearchRun } from '../hooks/use-deep-research-runs';
import { useDeepResearchStream } from '../hooks/use-deep-research-stream';
import { DeepResearchErrorCard } from './error-cards';
import { HistoryRail } from './history-rail';
import { ResearchComposer } from './research-composer';
import { ResearchResult } from './research-result';
import { RunStepper } from './run-stepper';

const BASE = '/research';

function followUpDraft(question: string): string {
  return `${question.trim()}\n\nFollow-up: `;
}

function QuestionHeading({ question }: { question: string }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
        Research question
      </p>
      <h1 className="whitespace-pre-line font-serif text-xl font-semibold leading-8 text-warm-ink sm:text-2xl">
        {question}
      </h1>
    </div>
  );
}

/** A saved run from GET /deep-research/:id — same result view, no stepper. */
function SavedRun({ runId, onFollowUp }: { runId: string; onFollowUp: (q: string) => void }) {
  const { data: run, isLoading, isError } = useDeepResearchRun(runId);

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="saved-run-loading">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !run) {
    return (
      <DeepResearchErrorCard
        error={{ code: 'internal', message: 'This research run could not be found.' }}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="saved-run">
      <QuestionHeading question={run.question} />
      {run.status === 'running' ? (
        <p className="text-sm text-warm-ink-mid">This run is still in progress. Check back shortly.</p>
      ) : run.status === 'failed' || !run.resultJson ? (
        <DeepResearchErrorCard
          error={{ code: 'internal', message: 'This run did not finish, so no answer was saved.' }}
        />
      ) : (
        <ResearchResult
          question={run.question}
          result={run.resultJson}
          sources={run.sourcesJson ?? []}
          onFollowUp={() => onFollowUp(run.question)}
        />
      )}
    </div>
  );
}

export function DeepResearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const runParam = params?.get('run') ?? null;
  const prefill = params?.get('q') ?? '';
  const { state, start, reset } = useDeepResearchStream();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Once a live run is saved, give it its own URL (reload / share / history
  // highlight) without swapping the live view for a refetch.
  const finishedRunId = state.done?.runId ?? null;
  useEffect(() => {
    if (finishedRunId && runParam !== finishedRunId) {
      router.replace(`${BASE}?run=${encodeURIComponent(finishedRunId)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedRunId]);

  const showLive =
    state.status !== 'idle' && (!runParam || runParam === finishedRunId);

  const goNew = useCallback(() => {
    reset();
    setHistoryOpen(false);
    router.push(BASE);
  }, [reset, router]);

  const selectRun = useCallback(
    (id: string) => {
      reset();
      setHistoryOpen(false);
      router.push(`${BASE}?run=${encodeURIComponent(id)}`);
    },
    [reset, router],
  );

  const followUp = useCallback(
    (question: string) => {
      reset();
      router.push(`${BASE}?q=${encodeURIComponent(followUpDraft(question))}`);
    },
    [reset, router],
  );

  const onDeleted = useCallback(
    (id: string) => {
      if (id === runParam || id === finishedRunId) goNew();
    },
    [runParam, finishedRunId, goNew],
  );

  const activeRunId = runParam ?? finishedRunId;
  const rail = (
    <HistoryRail
      activeRunId={activeRunId}
      onSelect={selectRun}
      onNew={goNew}
      onDeleted={onDeleted}
    />
  );

  let main: React.ReactNode;
  if (showLive) {
    const question = state.question ?? '';
    main = (
      <div className="space-y-6" data-testid="live-run">
        <QuestionHeading question={question} />
        {state.status === 'streaming' && (
          <div className="rounded-xl border border-warm-ink/10 bg-warm-surface p-5">
            <RunStepper state={state} />
          </div>
        )}
        {state.status === 'error' && state.error && (
          <DeepResearchErrorCard error={state.error} onRetry={() => void start(question)} />
        )}
        {state.status !== 'error' && state.result && (
          <ResearchResult
            question={question}
            result={state.result}
            sources={state.sources}
            onFollowUp={() => followUp(question)}
          />
        )}
        {state.status === 'done' && !state.result && (
          <DeepResearchErrorCard
            error={{ code: 'internal', message: 'The run finished without an answer.' }}
            onRetry={() => void start(question)}
          />
        )}
      </div>
    );
  } else if (runParam) {
    main = <SavedRun runId={runParam} onFollowUp={followUp} />;
  } else {
    main = <ResearchComposer initialQuestion={prefill} onSubmit={(q) => void start(q)} />;
  }

  return (
    <div className="flex min-h-full gap-6">
      <aside
        aria-label="Research history"
        className="hidden w-64 shrink-0 lg:block lg:sticky lg:top-0 lg:h-[calc(100vh-8rem)]"
      >
        {rail}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <HistoryIcon aria-hidden />
            History
          </Button>
          {(showLive || runParam) && (
            <Button variant="ghost" size="sm" onClick={goNew}>
              New research
            </Button>
          )}
        </div>
        {main}
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-80 bg-warm-cream p-4 pt-12">
          <SheetTitle className="sr-only">Research history</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>
    </div>
  );
}
