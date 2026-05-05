import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseMatters = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useMatters: (...args: unknown[]) => mockUseMatters(...args),
  useDeleteMatter: () => ({ mutate: (...a: unknown[]) => mockDeleteMutate(...a), mutateAsync: jest.fn() }),
}));

import MattersListScreen from '@/app/workspace/matters/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeMattersMock(data: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    data: { data, meta: { hasNext: false, limit: 30 } },
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

describe('MattersListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state when no matters', () => {
    mockUseMatters.mockReturnValue(makeMattersMock([]));
    const { getByText } = render(<MattersListScreen />, { wrapper: createWrapper() });
    expect(getByText('No matters yet')).toBeTruthy();
    expect(getByText('Create a matter to organize your legal work')).toBeTruthy();
  });

  it('renders status filter chips', () => {
    mockUseMatters.mockReturnValue(makeMattersMock([]));
    const { getByText } = render(<MattersListScreen />, { wrapper: createWrapper() });
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
    expect(getByText('Closed')).toBeTruthy();
    expect(getByText('Archived')).toBeTruthy();
  });

  it('renders matter cards with correct data', () => {
    mockUseMatters.mockReturnValue(makeMattersMock([
      {
        id: 'm-1',
        title: 'Smith v. Jones',
        status: 'active',
        matterType: 'civil',
        court: 'RTC Branch 1',
        description: 'Breach of contract',
        owner: { id: 'u-1', fullName: 'Juan Dela Cruz', email: 'juan@test.com' },
        _count: { documents: 3, notes: 1 },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ]));
    const { getByText } = render(<MattersListScreen />, { wrapper: createWrapper() });
    expect(getByText('Smith v. Jones')).toBeTruthy();
    expect(getByText('Breach of contract')).toBeTruthy();
    expect(getByText('3 docs | 1 notes')).toBeTruthy();
    expect(getByText('Juan Dela Cruz')).toBeTruthy();
  });

  it('navigates to matter detail on card press', () => {
    mockUseMatters.mockReturnValue(makeMattersMock([
      {
        id: 'm-1',
        title: 'Test Matter',
        status: 'active',
        matterType: null,
        court: null,
        description: null,
        owner: { id: 'u-1', fullName: 'Juan', email: 'j@t.com' },
        _count: { documents: 0, notes: 0 },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ]));
    const { getByText } = render(<MattersListScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Test Matter'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/workspace/matters/m-1');
  });
});
