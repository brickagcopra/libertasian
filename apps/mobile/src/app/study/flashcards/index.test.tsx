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

const mockUseFlashcardSets = jest.fn();
jest.mock('../../../features/study/hooks/use-flashcard-sets', () => ({
  useFlashcardSets: (...args: unknown[]) => mockUseFlashcardSets(...args),
  useCreateFlashcardSet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteFlashcardSet: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: () => ({ data: [{ id: 's1', code: 'civil_law', name: 'Civil Law' }], isLoading: false }),
}));

jest.mock('../../../features/study/components/flashcard-set-card', () => ({
  FlashcardSetCard: ({ item, onPress }: { item: { title: string }; onPress: () => void }) => {
    const { Text, TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress}>
        <Text>{item.title}</Text>
      </TouchableOpacity>
    );
  },
}));

import FlashcardSetsScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('FlashcardSetsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseFlashcardSets.mockReturnValue({ data: undefined, isLoading: true, isFetching: false, refetch: jest.fn() });
    const { UNSAFE_root } = render(<FlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state with create button', () => {
    mockUseFlashcardSets.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<FlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getByText(/No flashcard sets/i)).toBeTruthy();
  });

  it('renders flashcard set cards', () => {
    mockUseFlashcardSets.mockReturnValue({
      data: {
        data: [
          { id: 'fs-1', title: 'Civil Law Basics', cardCount: 20, barSubject: 'civil_law', createdAt: '2024-01-01' },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<FlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil Law Basics')).toBeTruthy();
  });

  it('renders subject filter chips', () => {
    mockUseFlashcardSets.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getAllByText } = render(<FlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getAllByText('All')[0]).toBeTruthy();
    expect(getAllByText('Civil Law')[0]).toBeTruthy();
  });

  it('navigates to flashcard set on card press', () => {
    mockUseFlashcardSets.mockReturnValue({
      data: {
        data: [
          { id: 'fs-1', title: 'Civil Law Basics', cardCount: 20, barSubject: 'civil_law', createdAt: '2024-01-01' },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<FlashcardSetsScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Civil Law Basics'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/study/flashcards/fs-1');
  });
});
