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

const mockUseAdminDoctrines = jest.fn();
jest.mock('../../../features/admin/hooks/use-admin-doctrines', () => ({
  useAdminDoctrines: (...args: unknown[]) => mockUseAdminDoctrines(...args),
  useApproveDoctrine: () => ({ mutate: jest.fn(), isPending: false }),
  useRejectDoctrine: () => ({ mutate: jest.fn(), isPending: false }),
}));

import DoctrinesListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('DoctrinesListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseAdminDoctrines.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    });
    const { UNSAFE_root } = render(<DoctrinesListScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state', () => {
    mockUseAdminDoctrines.mockReturnValue({
      data: { items: [], meta: { hasNext: false, limit: 20 } },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    });
    const { getByText } = render(<DoctrinesListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No doctrines/i)).toBeTruthy();
  });

  it('renders doctrine cards', () => {
    mockUseAdminDoctrines.mockReturnValue({
      data: {
        items: [
          {
            id: 'd-1',
            text: 'The doctrine of res judicata bars re-litigation.',
            normalizedText: null,
            doctrineType: 'ratio_decidendi',
            reviewStatus: 'pending',
            confidence: 0.85,
            createdAt: '2024-01-15',
            legalDocumentId: null,
            legalDocument: null,
          },
        ],
        meta: { hasNext: false, limit: 20 },
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    });
    const { getByText } = render(<DoctrinesListScreen />, { wrapper: createWrapper() });
    expect(getByText(/res judicata/)).toBeTruthy();
  });

  it('navigates to doctrine detail on press', () => {
    mockUseAdminDoctrines.mockReturnValue({
      data: {
        items: [
          {
            id: 'd-1',
            text: 'Test doctrine',
            normalizedText: null,
            doctrineType: 'ratio_decidendi',
            reviewStatus: 'pending',
            confidence: 0.9,
            createdAt: '2024-01-15',
            legalDocumentId: null,
            legalDocument: null,
          },
        ],
        meta: { hasNext: false, limit: 20 },
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    });
    const { getByText } = render(<DoctrinesListScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Test doctrine'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalled();
  });
});
