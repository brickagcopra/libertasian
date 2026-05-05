import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}), { virtual: true });

const mockUseApiKeys = jest.fn();
jest.mock('@/features/api-keys/hooks/use-api-keys', () => ({
  useApiKeys: () => mockUseApiKeys(),
  useCreateApiKey: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, error: null }),
  useUpdateApiKey: () => ({ mutateAsync: jest.fn() }),
  useDeleteApiKey: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/features/api-keys/types', () => ({
  ALL_PERMISSIONS: [
    { value: 'search', label: 'Search' },
    { value: 'documents:read', label: 'Read Documents' },
  ],
  PERMISSION_LABELS: {
    search: 'Search',
    'documents:read': 'Read Documents',
  },
}));

import ApiKeysScreen from '@/app/settings/api-keys';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ApiKeysScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseApiKeys.mockReturnValue({ data: undefined, isLoading: true, isFetching: false, refetch: jest.fn() });
    const { UNSAFE_root } = render(<ApiKeysScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state with create CTA', () => {
    mockUseApiKeys.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ApiKeysScreen />, { wrapper: createWrapper() });
    expect(getByText(/No API Keys/i)).toBeTruthy();
  });

  it('renders API key cards', () => {
    mockUseApiKeys.mockReturnValue({
      data: {
        data: [
          {
            id: 'key-1',
            name: 'My API Key',
            keyPrefix: 'lbt_abc',
            isActive: true,
            permissions: ['search', 'documents:read'],
            rateLimitPerMinute: 100,
            createdAt: '2024-03-01T00:00:00Z',
            lastUsedAt: '2024-03-10T00:00:00Z',
            expiresAt: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ApiKeysScreen />, { wrapper: createWrapper() });
    expect(getByText('My API Key')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
  });

  it('shows delete confirmation on delete press', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockUseApiKeys.mockReturnValue({
      data: {
        data: [
          {
            id: 'key-1',
            name: 'Test Key',
            keyPrefix: 'lbt_xyz',
            isActive: true,
            permissions: [],
            rateLimitPerMinute: 100,
            createdAt: '2024-03-01T00:00:00Z',
            lastUsedAt: null,
            expiresAt: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ApiKeysScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Delete'));
    expect(alertSpy).toHaveBeenCalled();
  });
});
