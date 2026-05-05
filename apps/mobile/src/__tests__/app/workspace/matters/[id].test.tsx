import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'm-1' })),
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseMatter = jest.fn();
jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useMatter: (...args: unknown[]) => mockUseMatter(...args),
  useDeleteMatter: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useUpdateMatter: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useRemoveMatterDocument: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
}));

jest.mock('@/features/workspace/hooks/use-matter-comments', () => ({
  useMatterComments: () => ({ data: { data: [] }, isLoading: false }),
  useCreateMatterComment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteMatterComment: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
}));

jest.mock('@/features/workspace/components/share-sheet', () => ({
  ShareSheet: () => null,
}));

import MatterDetailScreen from '@/app/workspace/matters/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeMatterDetailMock(matter: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
  if (matter === null) {
    return {
      data: undefined,
      isLoading: true,
      refetch: jest.fn(),
      ...overrides,
    };
  }
  return {
    data: { data: matter },
    isLoading: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

const baseMatter = {
  id: 'm-1',
  organizationId: 'org-1',
  ownerUserId: 'u-1',
  title: 'Smith v. Jones',
  status: 'active',
  matterType: 'civil',
  court: 'RTC Branch 1',
  description: 'Contract dispute',
  owner: { id: 'u-1', fullName: 'Juan', email: 'juan@test.com' },
  documents: [],
  notes: [],
  _count: { documents: 0, notes: 0 },
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

describe('MatterDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state when data is not yet available', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(null));
    const { UNSAFE_root } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders matter title and tabs when data is loaded', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(baseMatter));
    const { getByText } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Smith v. Jones')).toBeTruthy();
    expect(getByText(/Documents/)).toBeTruthy();
    expect(getByText(/Notes/)).toBeTruthy();
    expect(getByText('Comments')).toBeTruthy();
    expect(getByText('Details')).toBeTruthy();
  });

  it('shows Add Document button in documents tab', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(baseMatter));
    const { getByText } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Add Document')).toBeTruthy();
  });

  it('shows status badge', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(baseMatter));
    const { getByText } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('active')).toBeTruthy();
  });

  it('shows court info', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(baseMatter));
    const { getByText } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('RTC Branch 1')).toBeTruthy();
  });

  it('shows empty documents message when no documents attached', () => {
    mockUseMatter.mockReturnValue(makeMatterDetailMock(baseMatter));
    const { getByText } = render(<MatterDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('No documents attached')).toBeTruthy();
  });
});
