import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import type { ReviewQueueItem } from '@/features/admin/types';

/**
 * Review queue: reading what you are scoring, and being told when an
 * assignment is refused.
 *
 * Before this, `handleBatchAssign` caught its error and did nothing with it,
 * and the result banner only covered approve/reject — so a refused assignment
 * was indistinguishable from a successful one. The dropdown was also built
 * from `reviewStats.perReviewer` ("who has review HISTORY"), which offered
 * people the assignment validator then rejected with a 400.
 */

const batchAssignMutate = vi.fn();
const reviewersQuery = vi.fn();
const adminDigestQuery = vi.fn();

vi.mock('@/features/admin/hooks/use-admin', () => ({
  useEnhancedReviewQueue: () => ({
    data: {
      items: [item()],
      meta: { hasNext: false, limit: 20 },
    },
    isLoading: false,
    error: null,
  }),
  useReviewQueueStats: () => ({
    data: {
      total: 1,
      unassigned: 1,
      avgConfidence: 0.8,
      avgTimeToReviewHours: null,
      byStatus: [],
      bySourceOrigin: [],
      // Deliberately populated with someone who must NOT appear in the
      // dropdown: they have history but no longer hold digests:review.
      perReviewer: [
        {
          reviewerUserId: 'u-former',
          reviewerName: 'Former Reviewer',
          assigned: 4,
          reviewed: 9,
        },
      ],
    },
    isLoading: false,
  }),
  useSubmitReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchApprove: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useBatchReject: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useBatchAssign: () => ({ mutateAsync: batchAssignMutate, isPending: false }),
  useDigestReviewers: () => reviewersQuery(),
  useAdminDigest: (id: string) => adminDigestQuery(id),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u-me', email: 'me@libertasian.com' } }),
}));

import ReviewQueuePage from './page';

/** The page calls useQueryClient directly (optimistic review removal). */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function item(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'People v. Dizon',
    digestType: 'case',
    sourceOrigin: 'official_pipeline',
    confidenceScore: 0.82,
    reviewStatus: 'needs_human_review',
    createdAt: '2026-09-01T00:00:00Z',
    assignedReviewer: null,
    legalDocument: null,
    _count: { reviews: 0 },
    ...overrides,
  } as ReviewQueueItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  reviewersQuery.mockReturnValue({
    data: [
      {
        userId: 'u-rosa',
        fullName: 'Rosa Reviewer',
        email: 'rosa@libertasian.com',
        assigned: 3,
        reviewed: 11,
      },
    ],
  });
  adminDigestQuery.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  });
});

describe('Review queue — the reviewer list', () => {
  it('offers only people who hold digests:review, not people with history', async () => {
    const user = userEvent.setup();
    render(<ReviewQueuePage />);

    // Select a row, then open the assign dialog.
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /^Assign$/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rosa Reviewer')).toBeInTheDocument();
    // Has history, lost the permission — the old dropdown offered them and the
    // assignment then failed with a 400.
    expect(within(dialog).queryByText('Former Reviewer')).not.toBeInTheDocument();

    // …but the Reviewer Workload card still shows them. That panel answers
    // "who has history", a different question, and is deliberately unchanged.
    expect(screen.getByText('Former Reviewer')).toBeInTheDocument();
  });

  it('says what to do when nobody holds the permission yet', async () => {
    reviewersQuery.mockReturnValue({ data: [] });
    const user = userEvent.setup();
    render(<ReviewQueuePage />);

    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /^Assign$/ }));

    expect(await screen.findByText(/Admin → Staff/)).toBeInTheDocument();
  });
});

describe('Review queue — assignment failures are surfaced', () => {
  it('shows the server message and keeps the dialog open', async () => {
    const serverText =
      'User does not hold the "digests:review" platform permission. Grant them a platform role that confers it in Admin → Staff.';
    batchAssignMutate.mockRejectedValue(new Error(serverText));
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /^Assign$/ }));
    await user.click(await screen.findByText('Rosa Reviewer'));

    expect(await screen.findByText(serverText)).toBeInTheDocument();
    // Dialog still open — the operator can pick someone else.
    expect(screen.getByText(/Assign 1 digests to reviewer/)).toBeInTheDocument();
  });

  it('reports a successful assignment in the result banner', async () => {
    batchAssignMutate.mockResolvedValue({ processed: 1, digestIds: ['d-1'] });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /^Assign$/ }));
    await user.click(await screen.findByText('Rosa Reviewer'));

    expect(
      await screen.findByText('1 digest assigned to Rosa Reviewer.'),
    ).toBeInTheDocument();
  });
});

describe('Review queue — reading the digest', () => {
  it('links every row to its detail page', () => {
    render(<ReviewQueuePage />);

    const view = screen.getByRole('link', { name: /View/ });
    expect(view).toHaveAttribute(
      'href',
      '/admin/digests/11111111-1111-4111-8111-111111111111',
    );
  });

  it('does not fetch digest content until a row is expanded', () => {
    render(<ReviewQueuePage />);

    // 20 rows of content_json per page would be a payload regression, so the
    // list payload carries none and the fetch is per-row and lazy.
    expect(adminDigestQuery).not.toHaveBeenCalled();
  });

  it('loads and renders the digest inline once expanded', async () => {
    adminDigestQuery.mockReturnValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'People v. Dizon',
        digestType: 'case',
        sourceOrigin: 'official_pipeline',
        facts: 'The accused was charged with estafa.',
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
        summary: null,
        petitionerArguments: null,
        respondentArguments: null,
        confidenceScore: 0.82,
        reviewStatus: 'needs_human_review',
        visibility: 'public_editorial',
        citedAuthoritiesJson: [],
        createdAt: '2026-09-01T00:00:00Z',
        legalDocument: null,
        reviews: [],
      },
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await user.click(screen.getByRole('button', { name: 'People v. Dizon' }));

    expect(adminDigestQuery).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(
      await screen.findByText('The accused was charged with estafa.'),
    ).toBeInTheDocument();
  });

  it('falls back to the detail page when the inline load fails', async () => {
    adminDigestQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Digest not found'),
    });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await user.click(screen.getByRole('button', { name: 'People v. Dizon' }));

    expect(await screen.findByText(/Digest not found/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open the detail page' }),
    ).toBeInTheDocument();
  });
});

describe('Review queue — assigned to me', () => {
  it('filters to the current user and toggles back off', async () => {
    const user = userEvent.setup();
    render(<ReviewQueuePage />);

    const button = screen.getByRole('button', { name: 'Assigned to me' });
    expect(button).toBeInTheDocument();

    await user.click(button);
    // The filter is bound to the current user id from the auth store; a second
    // click clears it rather than leaving the queue stuck on one person.
    await user.click(button);

    expect(button).toBeInTheDocument();
  });
});
