import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { ModerationCaseSummary, ModerationStats } from '@/features/moderation/types';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const STATS: ModerationStats = {
  openCases: 2,
  openReports: 5,
  overdueCases: 1,
  dueSoonCases: 0,
  oldestOpenAt: hoursAgo(30),
  resolvedLast7d: 12,
  medianResolutionHours7d: 6.5,
  activeSanctions: 1,
  openAppeals: 2,
};

const CASES: ModerationCaseSummary[] = [
  {
    targetType: 'post',
    targetId: 'p1',
    reportCount: 4,
    reasons: { spam: 3, harassment: 1 },
    firstReportedAt: hoursAgo(30),
    lastReportedAt: hoursAgo(2),
    preview: 'Buy cheap bar review notes at my site',
    author: { id: 'u1', fullName: 'Juan Dela Cruz' },
    contentStatus: 'hidden',
    autoHidden: true,
    status: 'open',
    resolution: null,
    resolvedAt: null,
  },
  {
    targetType: 'comment',
    targetId: 'c1',
    reportCount: 1,
    reasons: { off_topic: 1 },
    firstReportedAt: hoursAgo(2),
    lastReportedAt: hoursAgo(2),
    preview: 'This has nothing to do with the thread',
    author: { id: 'u2', fullName: 'Maria Clara' },
    contentStatus: 'visible',
    autoHidden: false,
    status: 'open',
    resolution: null,
    resolvedAt: null,
  },
];

const useModerationCases = vi.fn();
const bulkMutate = vi.fn();

vi.mock('@/features/moderation/hooks/use-moderation', () => ({
  useModerationStats: () => ({ data: STATS, isLoading: false, error: null }),
  useModerationCases: (q: unknown) => useModerationCases(q),
  useModerationSanctions: () => ({ data: undefined, isLoading: false, error: null }),
  useModerationLog: () => ({ data: undefined, isLoading: false, error: null }),
  useRevokeSanction: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useModerationAppeals: () => ({ data: undefined, isLoading: false, error: null }),
  useDecideAppeal: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useBulkResolve: () => ({ mutate: bulkMutate, isPending: false, error: null, reset: vi.fn() }),
}));

import ModerationQueuePage from './page';

describe('Moderation queue page', () => {
  it('renders stat cards and one row per case', () => {
    useModerationCases.mockReturnValue({
      data: { data: CASES, meta: { total: 2, hasNext: false } },
      isLoading: false,
      isFetching: false,
      error: null,
    });

    render(<ModerationQueuePage />);

    expect(screen.getByText('Open cases')).toBeInTheDocument();
    expect(screen.getByText('Over 24h')).toBeInTheDocument();
    expect(screen.getByText('6.5h')).toBeInTheDocument();

    // Default query: open, all types, oldest first, first page.
    expect(useModerationCases).toHaveBeenCalledWith({
      status: 'open',
      type: 'all',
      sort: 'oldest',
      limit: 25,
      offset: 0,
    });

    const rows = screen.getAllByTestId('moderation-case-row');
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText('Post')).toBeInTheDocument();
    expect(first.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(first.getByText('Buy cheap bar review notes at my site')).toBeInTheDocument();
    expect(first.getByText('Spam ×3')).toBeInTheDocument();
    expect(first.getByText('Auto-hidden')).toBeInTheDocument();
    expect(first.getByText('Hidden')).toBeInTheDocument();
    expect(rows[0]!.querySelector('[data-sla]')).toHaveAttribute('data-sla', 'overdue');

    const second = within(rows[1]!);
    expect(second.getByText('Comment')).toBeInTheDocument();
    expect(second.getByText('Off-topic')).toBeInTheDocument();
    expect(second.queryByText('Auto-hidden')).not.toBeInTheDocument();
    expect(rows[1]!.querySelector('[data-sla]')).toHaveAttribute('data-sla', 'ok');
  });

  it('shows an empty state when the queue is clear', () => {
    useModerationCases.mockReturnValue({
      data: { data: [], meta: { total: 0, hasNext: false } },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<ModerationQueuePage />);
    expect(screen.getByText('No open cases. The queue is clear.')).toBeInTheDocument();
  });

  it('shows the open appeal count on the Appeals tab', () => {
    useModerationCases.mockReturnValue({
      data: { data: [], meta: { total: 0, hasNext: false } },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<ModerationQueuePage />);
    expect(screen.getByRole('tab', { name: 'Appeals (2)' })).toBeInTheDocument();
  });

  it('bulk-dismisses the selected cases', () => {
    bulkMutate.mockReset();
    useModerationCases.mockReturnValue({
      data: { data: CASES, meta: { total: 2, hasNext: false } },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<ModerationQueuePage />);

    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all cases on this page' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Dismiss reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2' }));

    expect(bulkMutate).toHaveBeenCalledWith(
      {
        decision: 'dismiss',
        cases: [
          { targetType: 'post', targetId: 'p1' },
          { targetType: 'comment', targetId: 'c1' },
        ],
      },
      expect.anything(),
    );
  });

  it('a bulk removal needs a reason before it can be confirmed', () => {
    useModerationCases.mockReturnValue({
      data: { data: CASES, meta: { total: 2, hasNext: false } },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<ModerationQueuePage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select post case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove content' }));
    expect(screen.getByRole('button', { name: 'Remove 1' })).toBeDisabled();
  });
});
