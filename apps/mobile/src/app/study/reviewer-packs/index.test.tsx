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

const mockUseReviewerPacks = jest.fn();
jest.mock('../../../features/study/hooks/use-reviewer-packs', () => ({
  useReviewerPacks: (...args: unknown[]) => mockUseReviewerPacks(...args),
  useCreateReviewerPack: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteReviewerPack: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: () => ({ data: [{ id: 's1', code: 'civil_law', name: 'Civil Law' }], isLoading: false }),
}));

jest.mock('../../../features/study/components/reviewer-pack-card', () => ({
  ReviewerPackCard: ({ item, onPress }: { item: { title: string }; onPress: () => void }) => {
    const { Text, TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress}>
        <Text>{item.title}</Text>
      </TouchableOpacity>
    );
  },
}));

import ReviewerPacksScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ReviewerPacksScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseReviewerPacks.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText(/No reviewer packs/i)).toBeTruthy();
  });

  it('renders reviewer pack cards', () => {
    mockUseReviewerPacks.mockReturnValue({
      data: {
        data: [
          { id: 'rp-1', title: 'Criminal Law Review', itemCount: 15, barSubject: 'criminal_law', createdAt: '2024-02-01' },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText('Criminal Law Review')).toBeTruthy();
  });

  it('renders subject filter chips', () => {
    mockUseReviewerPacks.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getAllByText } = render(<ReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getAllByText('All')[0]).toBeTruthy();
    expect(getAllByText('Civil Law')[0]).toBeTruthy();
  });

  it('navigates to pack detail on press', () => {
    mockUseReviewerPacks.mockReturnValue({
      data: {
        data: [{ id: 'rp-1', title: 'Crim Review', itemCount: 5, barSubject: null, createdAt: '2024-02-01' }],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewerPacksScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Crim Review'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/study/reviewer-packs/rp-1');
  });
});
