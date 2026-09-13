import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { GenerationJobSummary } from '@/features/admin/hooks/use-admin-bar-exam-answers';

import { GenerationJobsPanel } from './generation-jobs-panel';

function job(
  overrides?: Partial<GenerationJobSummary>,
): GenerationJobSummary {
  return {
    id: 'job-1',
    status: 'completed',
    total: 10,
    onlyMissing: false,
    filters: { regeneratePending: true },
    triggeredByUserId: null,
    createdAt: '2026-09-13T10:00:00Z',
    startedAt: '2026-09-13T10:00:05Z',
    finishedAt: '2026-09-13T10:04:00Z',
    lastItemUpdatedAt: '2026-09-13T10:04:00Z',
    done: 10,
    stalled: false,
    counts: {
      queued: 0,
      running: 0,
      generated: 6,
      generatedUngrounded: 1,
      skippedExisting: 1,
      keptExisting: 2,
      failed: 0,
    },
    ...overrides,
  };
}

function renderPanel(summary: GenerationJobSummary = job()) {
  return render(
    <GenerationJobsPanel
      jobs={[summary]}
      expandedJobId={null}
      onToggleExpand={vi.fn()}
      onCancel={vi.fn()}
      onRetryFailed={vi.fn()}
    />,
  );
}

describe('GenerationJobsPanel', () => {
  it('reports kept-existing answers and says why they were kept', () => {
    // A regeneration that ran and lost to the answer already on the row.
    // Without a label of its own it reads as either a silent success or a
    // failure, and an editor has no way to tell that 2 of 10 questions kept
    // the draft they already had.
    renderPanel();

    expect(
      screen.getByText(/2 kept existing \(new answer wasn't better\)/),
    ).toBeInTheDocument();
  });

  it('counts kept-existing answers towards done rather than failed', () => {
    renderPanel();

    expect(screen.getByText(/10\/10 done \(100%\)/)).toBeInTheDocument();
    expect(screen.getByText(/0 failed/)).toBeInTheDocument();
    // Nothing to retry: the retry button is for failures only.
    expect(screen.queryByText(/Retry failed/)).not.toBeInTheDocument();
  });
});
