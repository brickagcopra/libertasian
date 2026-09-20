import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AssignableReviewer, ReviewQueueItem } from '@/features/admin/types';

const mockBatchAssign = vi.fn();
const mockAdminDigest = vi.fn();

let mockReviewers: AssignableReviewer[] = [];
let mockItems: ReviewQueueItem[] = [];
const mockQueueParams: Array<Record<string, unknown> | undefined> = [];

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u-me', fullName: 'Me' } }),
  ),
}));

vi.mock('@/features/digests/components/digest-content-panel', () => ({
  DigestContentPanel: () => <div>digest content panel</div>,
}));

vi.mock('@/features/admin/hooks/use-admin', () => ({
  useEnhancedReviewQueue: (params?: Record<string, unknown>) => (
    mockQueueParams.push(params),
    {
      data: { items: mockItems, meta: { hasNext: false } },
      isLoading: false,
      error: null,
    }
  ),
  useReviewQueueStats: () => ({
    data: {
      total: 1,
      byStatus: [],
      bySourceOrigin: [],
      unassigned: 1,
      avgConfidence: null,
      avgTimeToReviewHours: null,
      // Deliberately DIFFERENT from mockReviewers: a stale reviewer with
      // history, who must no longer be offered as an assignee.
      perReviewer: [
        { reviewerUserId: 'u-revoked', reviewerName: 'Revoked Rita', assigned: 4, reviewed: 9 },
      ],
    },
    isLoading: false,
  }),
  useReviewers: () => ({ data: mockReviewers }),
  useAdminDigest: (id: string) => mockAdminDigest(id),
  useSubmitReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchApprove: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useBatchReject: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useBatchAssign: () => ({ mutateAsync: mockBatchAssign, isPending: false }),
}));

import ReviewQueuePage from './page';

/** The card's optimistic-removal path calls useQueryClient(). */
function render(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function item(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 'd-1',
    title: 'People v. Cruz',
    digestType: 'case_digest',
    sourceOrigin: 'official_pipeline',
    reviewStatus: 'needs_human_review',
    confidenceScore: 0.82,
    createdAt: '2026-09-01T00:00:00.000Z',
    assignedReviewer: null,
    legalDocument: null,
    _count: { reviews: 0 },
    ...overrides,
  } as ReviewQueueItem;
}

/**
 * The review queue a reviewer can actually work.
 *
 * Three things were structurally wrong before:
 *  - the assign picker was fed from stats.perReviewer ("who has review
 *    history"), so it offered people whose grant had been revoked — the assign
 *    then 400'd — and hid newly-granted reviewers with nothing assigned yet;
 *  - handleBatchAssign swallowed the error and the result banner covered only
 *    approve/reject, so a failed assign looked exactly like nothing happening;
 *  - there was no way to read the digest being scored: no link to the full
 *    view, and the expand showed only the source document's metadata.
 */
describe('ReviewQueuePage', () => {
  beforeEach(() => {
    mockBatchAssign.mockReset();
    mockAdminDigest.mockReset();
    mockAdminDigest.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mockQueueParams.length = 0;
    mockItems = [item()];
    mockReviewers = [
      {
        userId: 'u-rey',
        fullName: 'Rey Reviewer',
        email: 'rey@libertasian.com',
        assigned: 2,
        reviewed: 5,
      },
      {
        userId: 'u-me',
        fullName: 'Me',
        email: 'me@libertasian.com',
        assigned: 0,
        reviewed: 0,
      },
    ];
  });

  it('links each row to the full digest view', async () => {
    render(<ReviewQueuePage />);

    const link = await screen.findByRole('link', { name: /view/i });
    expect(link).toHaveAttribute('href', '/admin/digests/d-1');
  });

  it('does not load digest content until the row is expanded', async () => {
    render(<ReviewQueuePage />);

    // 20 rows of content_json per page would be a payload regression; the
    // detail fetch must not happen for a collapsed row.
    expect(mockAdminDigest).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'People v. Cruz' }));

    await waitFor(() => expect(mockAdminDigest).toHaveBeenCalledWith('d-1'));
  });

  it('renders the digest content inline once loaded', async () => {
    mockAdminDigest.mockReturnValue({
      data: { id: 'd-1', citedAuthoritiesJson: null },
      isLoading: false,
      error: null,
    });
    render(<ReviewQueuePage />);

    await userEvent.click(screen.getByRole('button', { name: 'People v. Cruz' }));

    expect(await screen.findByText('digest content panel')).toBeInTheDocument();
  });

  it('feeds the assign dialog from the reviewers endpoint, not from review history', async () => {
    render(<ReviewQueuePage />);

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rey Reviewer')).toBeInTheDocument();
    // Has review history, but no longer holds digests:review — offering them
    // would produce a 400. (She still appears in the Reviewer Workload card
    // outside the dialog, which is history and therefore the right source
    // there.)
    expect(within(dialog).queryByText('Revoked Rita')).not.toBeInTheDocument();
    expect(screen.getByText('Revoked Rita')).toBeInTheDocument();
  });

  it('surfaces the server message and keeps the dialog open when an assign fails', async () => {
    mockBatchAssign.mockRejectedValue(
      new Error('User is not platform staff with the "digests:review" permission'),
    );
    render(<ReviewQueuePage />);

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Rey Reviewer/ }));

    expect(await screen.findByText(/digests:review/)).toBeInTheDocument();
    // Dialog still open, so the selection survives and another reviewer can be
    // tried without re-selecting 20 rows.
    expect(screen.getByText('Rey Reviewer')).toBeInTheDocument();
  });

  it('reports a successful assign in the result banner', async () => {
    mockBatchAssign.mockResolvedValue({ processed: 1, digestIds: ['d-1'] });
    render(<ReviewQueuePage />);

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Rey Reviewer/ }));

    expect(
      await screen.findByText(/Batch operation complete: 1 digests processed/),
    ).toBeInTheDocument();
  });

  it('offers an "Assigned to me" filter bound to the current user', async () => {
    render(<ReviewQueuePage />);

    // Radix's Select trigger sets pointer-events: none on the body while
    // closed, which jsdom reports literally; the check is not meaningful here.
    await userEvent.click(screen.getByText('All Assignees'), {
      pointerEventsCheck: 0,
    });

    const option = await screen.findByText('Assigned to me');
    await userEvent.click(option, { pointerEventsCheck: 0 });

    // Bound to the current user's ID — the value the API filters on — not to
    // a name.
    await waitFor(() => {
      expect(mockQueueParams.at(-1)).toMatchObject({ assignedTo: 'u-me' });
    });
  });

  it('explains what to do when nobody holds the reviewer permission', async () => {
    mockReviewers = [];
    render(<ReviewQueuePage />);

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /assign/i }));

    expect(await screen.findByText(/digests:review/)).toBeInTheDocument();
  });
});
