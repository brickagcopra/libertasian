import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  JOBS_POLL_MS,
  jobsPollInterval,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';

const mockUseBarExamAnswers = vi.hoisted(() => vi.fn());
const mockUseCoverage = vi.hoisted(() => vi.fn());
const mockUseJobs = vi.hoisted(() => vi.fn());
const mockUseJobDetail = vi.hoisted(() => vi.fn());
const mockDispatchMutate = vi.hoisted(() => vi.fn());
const mockBulkApproveMutate = vi.hoisted(() => vi.fn());
const mockBulkRejectMutate = vi.hoisted(() => vi.fn());
const mockCancelMutate = vi.hoisted(() => vi.fn());
const mockRetryMutate = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/features/admin/hooks/use-admin-bar-exam-answers', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/admin/hooks/use-admin-bar-exam-answers')
  >('@/features/admin/hooks/use-admin-bar-exam-answers');
  return {
    ...actual,
    useBarExamAnswers: mockUseBarExamAnswers,
    useBarExamAnswerCoverage: mockUseCoverage,
    useBarExamAnswerGenerationJobs: mockUseJobs,
    useBarExamAnswerGenerationJob: mockUseJobDetail,
    useBarExamAnswerDetail: () => ({ data: undefined, isLoading: false }),
    useApproveBarExamAnswer: () => ({ mutate: vi.fn(), isPending: false }),
    useRejectBarExamAnswer: () => ({ mutate: vi.fn(), isPending: false }),
    useInvalidateBarExamAnswerViews: () => vi.fn(),
    useDispatchAnswerGeneration: () => ({
      mutate: mockDispatchMutate,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      data: undefined,
      error: null,
    }),
    useCancelGenerationJob: () => ({
      mutate: mockCancelMutate,
      isPending: false,
      variables: undefined,
    }),
    useRetryGenerationJobFailures: () => ({
      mutate: mockRetryMutate,
      isPending: false,
      variables: undefined,
    }),
    useBulkReviewBarExamAnswers: (action: 'approve' | 'reject') => ({
      mutate: action === 'approve' ? mockBulkApproveMutate : mockBulkRejectMutate,
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

import BarExamAnswersAdminPage from './page';

function answerRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    barExamQuestionId: `q-${id}`,
    answerType: 'ai_generated',
    reviewStatus: 'pending',
    visibility: 'private',
    confidence: 0.82,
    reviewedAt: null,
    reviewedByUserId: null,
    createdAt: '2026-09-13T10:00:00Z',
    updatedAt: '2026-09-13T10:00:00Z',
    question: {
      id: `q-${id}`,
      questionNumber: 1,
      excerpt: 'Discuss the doctrine of res ipsa loquitur.',
      sittingYear: 2018,
      subjectStudyCode: 'civil_law',
    },
    modelRun: null,
    ...overrides,
  };
}

const COVERAGE = {
  cells: [
    {
      year: 2018,
      subjectCode: 'civil_law',
      totalQuestions: 10,
      answered: 4,
      missing: 6,
      pending: 2,
      pendingAtOrAbove070: 1,
      approved: 2,
      rejected: 0,
      unscored: 1,
    },
  ],
  totals: {
    totalQuestions: 10,
    answered: 4,
    missing: 6,
    pending: 2,
    pendingAtOrAbove070: 1,
    approved: 2,
    rejected: 0,
    unscored: 1,
  },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BarExamAnswersAdminPage />
    </QueryClientProvider>,
  );
}

describe('BarExamAnswersAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBarExamAnswers.mockReturnValue({
      data: {
        items: [
        answerRow('a1'),
        answerRow('a2', {
          question: {
            id: 'q-a2',
            questionNumber: 2,
            excerpt: 'Explain the rule against perpetuities.',
            sittingYear: 2018,
            subjectStudyCode: 'civil_law',
          },
        }),
      ],
        meta: { hasNext: false, nextCursor: null, limit: 25 },
      },
      isLoading: false,
      error: null,
    });
    mockUseCoverage.mockReturnValue({ data: COVERAGE, isLoading: false });
    mockUseJobs.mockReturnValue({ data: { items: [] }, isLoading: false });
    mockUseJobDetail.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('sends reviewStatus="all" for the All chip instead of omitting it', () => {
    // Omitting the parameter lands on the API's 'pending' default — which is
    // precisely why the All chip used to show only pending rows.
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    const lastCall =
      mockUseBarExamAnswers.mock.calls[mockUseBarExamAnswers.mock.calls.length - 1]!;
    expect(lastCall[0]).toEqual(expect.objectContaining({ reviewStatus: 'all' }));
  });

  it('dispatch runs a dry run first, then dispatches on confirm', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Generate answers/i }));
    const dialog = screen.getByRole('dialog', { name: /Generate AI answers/i });
    fireEvent.change(within(dialog).getByLabelText(/^Year$/i), {
      target: { value: '2018' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Check count/i }),
    );

    expect(mockDispatchMutate).toHaveBeenCalledTimes(1);
    const [dryRunInput, handlers] = mockDispatchMutate.mock.calls[0]!;
    expect(dryRunInput).toEqual(expect.objectContaining({ dryRun: true, year: 2018 }));

    // Feed the dry-run result back the way the mutation would.
    act(() => {
      handlers.onSuccess({
        dryRun: true,
        total: 137,
        byYearSubject: [{ year: 2018, subjectCode: 'civil_law', count: 137 }],
      });
    });

    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /Generate AI answers/i }),
      ).getByRole('button', { name: /Confirm — generate 137/i }),
    );
    const [confirmInput] = mockDispatchMutate.mock.calls[1]!;
    expect(confirmInput.dryRun).toBeUndefined();
    expect(confirmInput).toEqual(expect.objectContaining({ year: 2018 }));
  });

  it('"Generate all missing" is labelled with the measured gap', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /Generate all missing \(6\)/i }),
    ).toBeInTheDocument();
  });

  it('the selection bar counts the selected rows and confirms before writing', () => {
    renderPage();

    fireEvent.click(
      screen.getByLabelText('Select answer for 2018 Q1', { selector: 'input' }),
    );
    expect(
      screen.getByRole('button', { name: 'Approve 1' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText(/Select all pending answers on this page/i),
    );
    expect(
      screen.getByRole('button', { name: 'Approve 2' }),
    ).toBeInTheDocument();

    // Nothing is written until the confirm dialog is accepted.
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    expect(mockBulkApproveMutate).not.toHaveBeenCalled();

    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: /Confirm bulk review/i }),
      ).getByRole('button', { name: 'Confirm' }),
    );
    expect(mockBulkApproveMutate).toHaveBeenCalledWith(
      { ids: ['a1', 'a2'] },
      expect.anything(),
    );
  });

  it('renders the coverage grid and opens a prefilled dispatch from a cell', () => {
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /2018 civil law: 4 of 10 answered/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Generate missing \(6\)/i }));

    const dialog = screen.getByRole('dialog', { name: /Generate AI answers/i });
    expect(within(dialog).getByLabelText(/Subject code/i)).toHaveValue(
      'civil_law',
    );
  });
});

describe('jobsPollInterval', () => {
  it('polls while a job is queued or running', () => {
    expect(jobsPollInterval([{ status: 'running' }])).toBe(JOBS_POLL_MS);
    expect(jobsPollInterval([{ status: 'completed' }, { status: 'queued' }])).toBe(
      JOBS_POLL_MS,
    );
  });

  it('stops polling once nothing is active', () => {
    expect(jobsPollInterval([])).toBe(false);
    expect(
      jobsPollInterval([
        { status: 'completed' },
        { status: 'completed_with_failures' },
        { status: 'cancelled' },
        { status: 'paused_budget' },
      ]),
    ).toBe(false);
    expect(jobsPollInterval(undefined)).toBe(false);
  });
});
