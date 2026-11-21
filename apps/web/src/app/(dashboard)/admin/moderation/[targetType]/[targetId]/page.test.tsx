import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { ModerationCaseDetail } from '@/features/moderation/types';

const resolveMutate = vi.fn();
const useModerationCase = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/moderation/post/p1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ targetType: 'post', targetId: 'p1' }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const idleMutation = () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() });

vi.mock('@/features/moderation/hooks/use-moderation', () => ({
  useModerationCase: (t: string, id: string) => useModerationCase(t, id),
  useResolveCase: () => ({ mutate: resolveMutate, isPending: false, error: null, reset: vi.fn() }),
  useRestoreContent: () => idleMutation(),
  useCreateSanction: () => idleMutation(),
  useRevokeSanction: () => idleMutation(),
}));

// Radix Select does not open under happy-dom; swap in a native <select>.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import ModerationCasePage from './page';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function makeCase(overrides: Partial<ModerationCaseDetail> = {}): ModerationCaseDetail {
  return {
    targetType: 'post',
    targetId: 'p1',
    reportCount: 2,
    reasons: { spam: 2 },
    firstReportedAt: hoursAgo(5),
    lastReportedAt: hoursAgo(1),
    preview: 'Buy notes',
    author: { id: 'u1', fullName: 'Juan Dela Cruz' },
    contentStatus: 'hidden',
    autoHidden: true,
    status: 'open',
    resolution: null,
    resolvedAt: null,
    content: {
      title: null,
      body: 'Buy notes\nat my site',
      rawStatus: 'hidden',
      createdAt: hoursAgo(6),
      editedAt: null,
    },
    context: null,
    reports: [
      {
        id: 'r1',
        reason: 'spam',
        details: 'Link farm',
        status: 'open',
        createdAt: hoursAgo(5),
        reporter: { id: 'u9', fullName: 'Rep Orter' },
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
      },
    ],
    authorProfile: {
      id: 'u1',
      fullName: 'Juan Dela Cruz',
      joinedAt: hoursAgo(1000),
      accountStatus: 'active',
      activeSanction: null,
      sanctions: [],
      stats: { posts: 4, comments: 10, removedContent: 1, reportsAgainst: 3, upheldReports: 1 },
      history: [],
    },
    history: [],
    canAct: true,
    canRemove: true,
    canRestore: false,
    ...overrides,
  };
}

beforeEach(() => {
  resolveMutate.mockReset();
  useModerationCase.mockReset();
});

describe('Moderation case detail page', () => {
  it('loads the case from the route params and shows content, reports and author stats', () => {
    useModerationCase.mockReturnValue({ data: makeCase(), isLoading: false, error: null });
    render(<ModerationCasePage />);

    expect(useModerationCase).toHaveBeenCalledWith('post', 'p1');
    expect(screen.getByText(/Buy notes/)).toBeInTheDocument();
    expect(screen.getByText('Link farm')).toBeInTheDocument();
    expect(screen.getByText('Upheld reports')).toBeInTheDocument();
    expect(screen.getByText('Back to queue')).toBeInTheDocument();
  });

  it('disables every action when canAct is false', () => {
    useModerationCase.mockReturnValue({
      data: makeCase({ canAct: false, canRestore: true }),
      isLoading: false,
      error: null,
    });
    render(<ModerationCasePage />);

    expect(screen.getByText("You can't moderate your own content")).toBeInTheDocument();
    for (const name of ['Dismiss reports', 'Remove content', 'Restore', 'Warn', 'Suspend', 'Ban']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('submits the remove dialog with the chosen reason, note and notify flag', () => {
    useModerationCase.mockReturnValue({ data: makeCase(), isLoading: false, error: null });
    render(<ModerationCasePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove content' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Remove content' });

    // Reason is required.
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'spam' } });
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
      target: { value: '  repeat spammer  ' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Notify author' }));

    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(resolveMutate).toHaveBeenCalledTimes(1);
    expect(resolveMutate.mock.calls[0]![0]).toEqual({
      targetType: 'post',
      targetId: 'p1',
      input: { decision: 'remove', reason: 'spam', notifyAuthor: false, note: 'repeat spammer' },
    });
  });

  it('warns that dismissing an auto-hidden item makes it visible again', () => {
    useModerationCase.mockReturnValue({ data: makeCase(), isLoading: false, error: null });
    render(<ModerationCasePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Dismissing makes it visible again/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss reports' }));
    expect(resolveMutate.mock.calls[0]![0]).toEqual({
      targetType: 'post',
      targetId: 'p1',
      input: { decision: 'dismiss' },
    });
  });
});
