import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ token: 'share-abc-123' })),
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseSharedContent = jest.fn();
const mockUseAccessSharedContentWithPassword = jest.fn();
jest.mock('../../features/workspace/hooks/use-shares', () => ({
  useSharedContent: (...args: unknown[]) => mockUseSharedContent(...args),
  useAccessSharedContentWithPassword: () => mockUseAccessSharedContentWithPassword(),
}));

import SharedContentScreen from './[token]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const defaultPasswordMock = { mutateAsync: jest.fn(), isPending: false, error: null, data: undefined };

describe('SharedContentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAccessSharedContentWithPassword.mockReturnValue(defaultPasswordMock);
  });

  it('shows loading state', () => {
    mockUseSharedContent.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<SharedContentScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows error state for invalid/expired link', () => {
    mockUseSharedContent.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<SharedContentScreen />, { wrapper: createWrapper() });
    expect(getByText('Not found')).toBeTruthy();
  });

  it('renders shared content with matter header', () => {
    mockUseSharedContent.mockReturnValue({
      data: {
        data: {
          requiresPassword: false,
          entityType: 'matter',
          permission: 'view',
          label: 'Shared Matter',
          data: {
            id: 'm-1',
            title: 'People v. Test',
            description: null,
            matterType: null,
            court: null,
            status: 'active',
            owner: { id: 'u-1', fullName: 'John Doe' },
            documents: [],
            notes: [],
            tasks: [],
            _count: { documents: 0, notes: 0, tasks: 0 },
            createdAt: '2024-03-01T00:00:00Z',
            updatedAt: '2024-03-01T00:00:00Z',
          },
        },
      },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<SharedContentScreen />, { wrapper: createWrapper() });
    expect(getByText('People v. Test')).toBeTruthy();
  });

  it('shows password input when required', () => {
    mockUseSharedContent.mockReturnValue({
      data: {
        data: {
          requiresPassword: true,
        },
      },
      isLoading: false,
      error: null,
    });
    const { getByPlaceholderText } = render(<SharedContentScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText(/password/i)).toBeTruthy();
  });

  it('renders document cards in documents tab', () => {
    mockUseSharedContent.mockReturnValue({
      data: {
        data: {
          requiresPassword: false,
          entityType: 'matter',
          permission: 'view',
          label: null,
          data: {
            id: 'm-1',
            title: 'Test Matter',
            description: null,
            matterType: null,
            court: null,
            status: 'active',
            owner: { id: 'u-1', fullName: 'John Doe' },
            documents: [
              { id: 'd-1', title: 'Exhibit A', role: 'evidence', legalDocument: null, createdAt: '2024-03-01T00:00:00Z' },
              { id: 'd-2', title: 'Exhibit B', role: 'reference', legalDocument: null, createdAt: '2024-03-01T00:00:00Z' },
            ],
            notes: [],
            tasks: [],
            _count: { documents: 2, notes: 0, tasks: 0 },
            createdAt: '2024-03-01T00:00:00Z',
            updatedAt: '2024-03-01T00:00:00Z',
          },
        },
      },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<SharedContentScreen />, { wrapper: createWrapper() });
    expect(getByText('Exhibit A')).toBeTruthy();
    expect(getByText('Exhibit B')).toBeTruthy();
  });
});
