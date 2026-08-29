import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseMatters = jest.fn();
jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useMatters: (...args: unknown[]) => mockUseMatters(...args),
}));

const mockUseNotes = jest.fn();
jest.mock('@/features/workspace/hooks/use-notes', () => ({
  useNotes: (...args: unknown[]) => mockUseNotes(...args),
}));

const mockUseTasks = jest.fn();
jest.mock('@/features/workspace/hooks/use-tasks', () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
}));

const mockUseActivity = jest.fn();
jest.mock('@/features/workspace/hooks/use-activity', () => ({
  useActivity: (...args: unknown[]) => mockUseActivity(...args),
}));

const mockUseMemos = jest.fn();
jest.mock('@/features/memos/hooks/use-memos', () => ({
  useMemos: (...args: unknown[]) => mockUseMemos(...args),
}));

const mockUseComparisons = jest.fn();
jest.mock('@/features/case-comparisons/hooks/use-case-comparisons', () => ({
  useComparisons: (...args: unknown[]) => mockUseComparisons(...args),
}));

const mockUsePleadings = jest.fn();
jest.mock('@/features/pleadings/hooks/use-pleadings', () => ({
  usePleadings: (...args: unknown[]) => mockUsePleadings(...args),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  // SurfaceGuard renders <Redirect> instead of the screen when the surface is
  // hidden. Rendered as a marker so a test can assert the redirect happened
  // AND that none of the screen mounted behind it.
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text testID="redirect">{href}</Text>;
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import WorkspaceTab from '@/app/(tabs)/workspace';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const defaultHookReturn = {
  data: { data: [] },
  isLoading: false,
  isFetching: false,
  refetch: jest.fn(),
};

describe('WorkspaceTab', () => {
  beforeEach(() => {
    // These cases are about the screen's content, so they stand in an
    // account that can reach it. The guard has its own block below.
    setEntitled();
    jest.clearAllMocks();
    mockUseMatters.mockReturnValue(defaultHookReturn);
    mockUseNotes.mockReturnValue(defaultHookReturn);
    mockUseTasks.mockReturnValue(defaultHookReturn);
    mockUseActivity.mockReturnValue(defaultHookReturn);
    mockUseMemos.mockReturnValue(defaultHookReturn);
    mockUseComparisons.mockReturnValue(defaultHookReturn);
    mockUsePleadings.mockReturnValue(defaultHookReturn);
  });

  it('shows loading state when all loading', () => {
    mockUseMatters.mockReturnValue({ ...defaultHookReturn, isLoading: true });
    mockUseNotes.mockReturnValue({ ...defaultHookReturn, isLoading: true });
    mockUseTasks.mockReturnValue({ ...defaultHookReturn, isLoading: true });

    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    // Should not show section headers when loading
    expect(queryByText('Recent Matters')).toBeNull();
  });

  it('renders stat cards with counts', () => {
    mockUseMatters.mockReturnValue({
      ...defaultHookReturn,
      data: {
        data: [
          { id: 'm1', title: 'Matter 1', status: 'active', court: null, updatedAt: '2024-06-01T00:00:00Z', _count: { documents: 0, notes: 0 } },
          { id: 'm2', title: 'Matter 2', status: 'active', court: null, updatedAt: '2024-06-01T00:00:00Z', _count: { documents: 0, notes: 0 } },
        ],
      },
    });
    mockUseNotes.mockReturnValue({
      ...defaultHookReturn,
      data: { data: [{ id: 'n1' }] },
    });
    mockUseTasks.mockReturnValue({
      ...defaultHookReturn,
      data: {
        data: [
          { id: 't1', title: 'Task 1', priority: 'low', assignedTo: null, dueDate: null },
          { id: 't2', title: 'Task 2', priority: 'low', assignedTo: null, dueDate: null },
          { id: 't3', title: 'Task 3', priority: 'low', assignedTo: null, dueDate: null },
        ],
      },
    });
    mockUseMemos.mockReturnValue({
      ...defaultHookReturn,
      data: { data: [] },
    });
    mockUseComparisons.mockReturnValue({
      ...defaultHookReturn,
      data: { data: [{ id: 'c1' }] },
    });
    mockUsePleadings.mockReturnValue({
      ...defaultHookReturn,
      data: { data: [] },
    });

    const { getByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Matters')).toBeTruthy();
    expect(getByText('Notes')).toBeTruthy();
    expect(getByText('Tasks')).toBeTruthy();
    expect(getByText('Memos')).toBeTruthy();
    expect(getByText('Comparisons')).toBeTruthy();
    expect(getByText('Pleadings')).toBeTruthy();
  });

  it('shows empty state for matters', () => {
    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No active matters')).toBeTruthy();
    expect(queryByText('New Matter')).toBeTruthy();
  });

  it('shows empty state for tasks', () => {
    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No open tasks')).toBeTruthy();
  });

  it('shows empty state for activity', () => {
    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No recent activity')).toBeTruthy();
  });

  it('renders section headers', () => {
    const { getByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Recent Matters')).toBeTruthy();
    expect(getByText('Open Tasks')).toBeTruthy();
    expect(getByText('Recent Activity')).toBeTruthy();
  });

  it('renders matter cards when data exists', () => {
    mockUseMatters.mockReturnValue({
      ...defaultHookReturn,
      data: {
        data: [
          {
            id: 'm1',
            title: 'Smith v. Jones',
            status: 'active',
            court: 'Supreme Court',
            updatedAt: '2024-06-15T00:00:00Z',
            _count: { documents: 3, notes: 5 },
          },
        ],
      },
    });

    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Smith v. Jones')).toBeTruthy();
    expect(queryByText('Supreme Court')).toBeTruthy();
    expect(queryByText('3 docs | 5 notes')).toBeTruthy();
  });

  it('renders task cards with priority', () => {
    mockUseTasks.mockReturnValue({
      ...defaultHookReturn,
      data: {
        data: [
          {
            id: 't1',
            title: 'Draft motion for reconsideration',
            priority: 'high',
            assignedTo: { fullName: 'Juan Cruz' },
            dueDate: '2024-07-01T00:00:00Z',
          },
        ],
      },
    });

    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Draft motion for reconsideration')).toBeTruthy();
    expect(queryByText('Juan Cruz')).toBeTruthy();
  });

  it('renders activity items', () => {
    mockUseActivity.mockReturnValue({
      ...defaultHookReturn,
      data: {
        data: [
          {
            id: 'a1',
            action: 'matter.create',
            actor: { fullName: 'Maria Santos' },
            createdAt: '2024-06-15T10:00:00Z',
          },
        ],
      },
    });

    const { queryByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText(/Maria Santos/)).toBeTruthy();
    expect(queryByText(/created a matter/)).toBeTruthy();
  });

  it('shows View All links', () => {
    const { getAllByText } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(getAllByText('View All').length).toBeGreaterThanOrEqual(2);
  });

  // Hiding the tab removes the way IN; it does not remove the route.
  // `(tabs)/_layout.tsx` uses `href: null`, which drops the tab button and
  // leaves `/(tabs)/workspace` registered — and `use-tab-bar-nav.ts` maps the
  // workspace destination to exactly that path. A deep link, a push
  // notification or a restored navigation state lands here without passing a
  // tab, and every tile and the New Matter button below 402 on the free tier.
  // `app/workspace/_layout.tsx` guards only `/workspace/*`, so this screen
  // needs its own guard — the pairing `/(tabs)/scan` and `/(tabs)/study` use.
  describe('free tier', () => {
    beforeEach(() => {
      setFreeTier();
    });

    it('redirects home instead of rendering the screen', () => {
      const { getByTestId } = render(<WorkspaceTab />, {
        wrapper: createWrapper(),
      });

      expect(getByTestId('redirect').props.children).toBe('/(tabs)');
    });

    it('mounts none of the dashboard behind the redirect', () => {
      const { queryByText } = render(<WorkspaceTab />, {
        wrapper: createWrapper(),
      });

      // No paid UI paints for a frame, and no requests fire.
      expect(queryByText('Recent Matters')).toBeNull();
      expect(queryByText('New Matter')).toBeNull();
      expect(mockUseMatters).not.toHaveBeenCalled();
    });

    it('presents no refusal — the point is to never show one', () => {
      const { queryByText } = render(<WorkspaceTab />, {
        wrapper: createWrapper(),
      });

      for (const word of ['Locked', 'Upgrade', 'Pro', 'Plan', 'Premium']) {
        expect(queryByText(word)).toBeNull();
      }
    });
  });

  it('renders the dashboard for an entitled account', () => {
    const { getByText, queryByTestId } = render(<WorkspaceTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByTestId('redirect')).toBeNull();
    expect(getByText('Recent Matters')).toBeTruthy();
  });
});
