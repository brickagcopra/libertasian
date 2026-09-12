import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseBudgetSnapshot = vi.hoisted(() => vi.fn());
const mockUseBudgetHistory = vi.hoisted(() => vi.fn());
const mockUpdateMutate = vi.hoisted(() => vi.fn());

vi.mock('@/features/admin/hooks/use-budget', () => ({
  useBudgetSnapshot: mockUseBudgetSnapshot,
  useBudgetHistory: mockUseBudgetHistory,
  useUpdateBudget: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import BudgetPage from './page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BudgetPage />
    </QueryClientProvider>,
  );
}

function scopeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    scope: 'case_digest',
    monthlyUsd: 5,
    dailyUsd: null,
    monthSpend: 1.25,
    daySpend: 0.1,
    monthRemaining: 3.75,
    stopped: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBudgetHistory.mockReturnValue({ data: [] });
  mockUseBudgetSnapshot.mockReturnValue({
    isLoading: false,
    data: {
      snapshot: {
        monthlyCeiling: 50,
        dailyCeiling: null,
        monthSpend: 12,
        daySpend: 0.5,
        monthUtilizationPercent: 24,
        dayUtilizationPercent: null,
        month: '2026-09',
        day: '2026-09-12',
      },
      byScope: [],
      scopeBudgets: [
        scopeRow(),
        scopeRow({ scope: 'flashcard', monthlyUsd: 0, monthRemaining: 0, monthSpend: 0 }),
      ],
    },
  });
});

describe('Admin → Budget — per-category ceilings', () => {
  it('lists every category with its limit, spend and remainder', () => {
    renderPage();

    expect(screen.getByText('Budget by Category')).toBeDefined();
    expect(screen.getByText('Case digests')).toBeDefined();
    expect(screen.getByText('Flashcards')).toBeDefined();
    expect(screen.getByText('$1.2500')).toBeDefined();
    expect(screen.getByText('$3.7500')).toBeDefined();
    // A category with no ceiling shows a dash, not a fake $0 remainder.
    expect(screen.getByText('—')).toBeDefined();
  });

  it('marks a category that has hit its own ceiling as stopped', () => {
    mockUseBudgetSnapshot.mockReturnValue({
      isLoading: false,
      data: {
        snapshot: {
          monthlyCeiling: 500,
          dailyCeiling: null,
          monthSpend: 12,
          daySpend: 0,
          monthUtilizationPercent: 2,
          dayUtilizationPercent: null,
          month: '2026-09',
          day: '2026-09-12',
        },
        byScope: [],
        scopeBudgets: [
          scopeRow({ monthSpend: 5.01, monthRemaining: 0, stopped: true }),
        ],
      },
    });

    renderPage();

    expect(screen.getByText('stopped')).toBeDefined();
  });

  it('saves one category without touching the others', () => {
    renderPage();

    const input = screen.getByLabelText('Monthly limit for Case digests');
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case digests budget' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      perScope: { case_digest: { monthlyUsd: 25, dailyUsd: null } },
    });
  });

  it('sends a daily limit when one is typed', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Monthly limit for Case digests'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByLabelText('Daily limit for Case digests'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case digests budget' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      perScope: { case_digest: { monthlyUsd: 25, dailyUsd: 2 } },
    });
  });

  it('a blank monthly limit clears the category back to the global ceiling', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Monthly limit for Case digests'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case digests budget' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      perScope: { case_digest: null },
    });
  });

  it('rejects an out-of-range limit instead of sending it', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Monthly limit for Case digests'), {
      target: { value: '999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case digests budget' }));

    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/between 0 and 100,000/)).toBeDefined();
  });

  it('routes the global ceiling through the same endpoint', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Monthly ceiling (USD)'), {
      target: { value: '75' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save overall ceilings' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyBudgetUsd: 75 }),
    );
  });
});

describe('Admin → Budget — budget-stop banner', () => {
  function withSnapshot(monthSpend: number, monthlyCeiling: number) {
    mockUseBudgetSnapshot.mockReturnValue({
      isLoading: false,
      data: {
        snapshot: {
          monthlyCeiling,
          dailyCeiling: null,
          monthSpend,
          daySpend: 0,
          monthUtilizationPercent: (monthSpend / (monthlyCeiling || 1)) * 100,
          dayUtilizationPercent: null,
          month: '2026-09',
          day: '2026-09-12',
        },
        byScope: [],
        scopeBudgets: [],
      },
    });
  }

  it('says generation is stopped once spend reaches the ceiling', () => {
    withSnapshot(50, 50);
    renderPage();

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('AI generation is stopped');
    expect(banner.textContent).toContain('$50.00');
  });

  it('stays quiet while there is budget left', () => {
    withSnapshot(12, 50);
    renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays quiet when no ceiling is set — $0 means unlimited, not stopped', () => {
    withSnapshot(0, 0);
    renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
