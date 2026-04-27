import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const dispatchCitations = vi.hoisted(() => vi.fn());
const fillMissing = vi.hoisted(() => vi.fn());
const sweepNow = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'admin-1', email: 'admin@test.com', fullName: 'Admin', role: 'admin' },
    accessToken: 'test-token',
    isAuthenticated: true,
  }),
}));

vi.mock('@/features/admin/hooks/use-admin', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/admin/hooks/use-admin')
  >('@/features/admin/hooks/use-admin');
  return {
    ...actual,
    useCorpusHealth: () => ({
      data: {
        corpus: {
          total: 100,
          published: 80,
          draft: 12,
          needsReview: 5,
          quarantined: 3,
        },
        documentsByType: [{ type: 'case', count: 60 }],
        sources: [],
        reviewQueue: { pendingDigests: 4, openFlags: 1 },
        pipelineOps: {
          activeBackfillBatches: {
            count: 2,
            items: [
              {
                id: 'bf-1',
                name: 'SC-2020',
                status: 'running',
                candidatesProcessed: 12,
                candidatesTotal: 100,
                lastTickAt: '2026-04-27T10:00:00.000Z',
              },
              {
                id: 'bf-2',
                name: 'CA-2021',
                status: 'running',
                candidatesProcessed: 0,
                candidatesTotal: 50,
                lastTickAt: null,
              },
            ],
          },
          last24hAutoPromotions: 7,
          citationsTotal: 40123,
          pendingReviewQueue: 85,
        },
      },
      isLoading: false,
      error: null,
    }),
    useDispatchCitationsBackfill: () => ({
      mutate: dispatchCitations,
      isPending: false,
    }),
    useBackfillMissingDerivatives: () => ({
      mutate: fillMissing,
      isPending: false,
    }),
    useTriggerAutoPromoteSweep: () => ({
      mutate: sweepNow,
      isPending: false,
    }),
    useAutoPromoteStatus: () => ({
      data: {
        lastSweepAt: '2026-04-27T01:00:00.000Z',
        lastPromoted: 5,
        last24hPromoted: 7,
        totalPromoted: 220,
        configThreshold: 0.7,
        configExcludedTypes: ['mcq_question'],
      },
    }),
  };
});

import AdminDashboardPage from './page';

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('Admin landing — Pipeline Operations tile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the four pipeline ops stat cards with values from the hook', () => {
    renderPage(<AdminDashboardPage />);

    expect(screen.getByText('Pipeline Operations')).toBeInTheDocument();
    expect(screen.getByText('Active Backfill Batches')).toBeInTheDocument();
    expect(screen.getByText('Auto-Promotions (24h)')).toBeInTheDocument();
    expect(screen.getByText('Citations Indexed')).toBeInTheDocument();
    expect(screen.getByText('Pending Review Queue')).toBeInTheDocument();

    // Each value rendered with toLocaleString — check on a stable one.
    expect(screen.getByText((40123).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('lists the active backfill batches', () => {
    renderPage(<AdminDashboardPage />);
    expect(screen.getByText('SC-2020')).toBeInTheDocument();
    expect(screen.getByText('CA-2021')).toBeInTheDocument();
    expect(screen.getByText(/12 \/ 100 processed/)).toBeInTheDocument();
  });
});

// ---- Buttons fire the mutations they're wired to ----

vi.mock('@/features/admin/hooks/use-derivatives-admin', () => ({
  useDerivativeStats: () => ({
    data: { byType: [], globalEnabled: true, typesEnabled: {} },
    isLoading: false,
  }),
  useDerivativeSettings: () => ({ data: { enabled: true, typesEnabled: {} } }),
  useUpdateDerivativeSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useDerivativeJobs: () => ({ data: { data: [], total: 0 } }),
  useEnqueueGeneration: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useRetryDerivativeJob: () => ({ mutate: vi.fn() }),
  useRegenerateArtifact: () => ({ mutate: vi.fn() }),
  useDeleteJobOutput: () => ({ mutate: vi.fn() }),
  useJobDigest: () => ({ data: null, isLoading: false, error: null }),
  useJobDoctrines: () => ({ data: null, isLoading: false, error: null }),
  useJobEssay: () => ({ data: null, isLoading: false, error: null }),
  useJobMcqs: () => ({ data: null, isLoading: false, error: null }),
  useJobFlashcards: () => ({ data: null, isLoading: false, error: null }),
  useJobOutlines: () => ({ data: null, isLoading: false, error: null }),
  useBulkApproveByConfidence: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    data: null,
    error: null,
    reset: vi.fn(),
  }),
}));

import DerivativesAdminPage from './derivatives/page';

describe('Derivatives admin — pipeline ops buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the Fill Missing dialog and fires the mutation on confirm', () => {
    renderPage(<DerivativesAdminPage />);

    fireEvent.click(screen.getByRole('button', { name: /fill missing derivatives/i }));
    // Confirm dialog visible
    expect(
      screen.getByRole('heading', { name: /fill missing derivatives/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(fillMissing).toHaveBeenCalledTimes(1);
    const firstCall = fillMissing.mock.calls[0];
    if (!firstCall) throw new Error('expected mutate to be called once');
    const call = firstCall[0] as { types: string[]; limit: number };
    expect(call.types.sort()).toEqual(['essay_prompt', 'flashcard', 'mcq_question']);
    expect(call.limit).toBe(200);
  });

  it('opens the Auto-Promote sweep dialog and fires the mutation on confirm', () => {
    renderPage(<DerivativesAdminPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /auto-promote sweep now/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /run sweep/i }));
    expect(sweepNow).toHaveBeenCalledTimes(1);
  });

  it('renders the auto-promote status row with values from the hook', () => {
    renderPage(<DerivativesAdminPage />);
    expect(screen.getByText('Last Sweep At')).toBeInTheDocument();
    expect(screen.getByText('Last 24h Promoted')).toBeInTheDocument();
    expect(screen.getByText('Total Promoted')).toBeInTheDocument();
    expect(screen.getByText('Threshold')).toBeInTheDocument();
    // Threshold value — multiple 0.7 might appear in form defaults; assert
    // the excluded-types caption to bind the assertion to the status row.
    expect(screen.getByText(/excludes mcq_question/i)).toBeInTheDocument();
  });
});
