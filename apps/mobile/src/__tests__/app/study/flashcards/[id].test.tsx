import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'fs-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseFlashcardSet = jest.fn();
const mockUseFlashcards = jest.fn();

jest.mock('@/features/study/hooks/use-flashcard-sets', () => ({
  useFlashcardSet: (...args: unknown[]) => mockUseFlashcardSet(...args),
}));

jest.mock('@/features/study/hooks/use-flashcards', () => ({
  useFlashcards: (...args: unknown[]) => mockUseFlashcards(...args),
}));

jest.mock('@/features/study/hooks/use-flashcard-reviews', () => ({
  useFlashcardReviewStats: () => ({ data: { data: { dueCount: 3 } } }),
  useSubmitFlashcardReview: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/features/study/hooks/use-study-progress', () => ({
  useUpsertStudyProgress: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/study/hooks/use-study-sessions', () => ({
  useStartStudySession: () => ({ mutate: jest.fn() }),
  useEndStudySession: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/study/hooks/use-study-export', () => ({
  useExportFlashcardSet: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/features/study/components/flashcard-player', () => ({
  FlashcardPlayer: ({ card }: { card: { front: string } }) => {
    const { Text } = require('react-native');
    return <Text>Card: {card?.front}</Text>;
  },
}));

jest.mock('@/features/study/components/progress-bar', () => ({
  ProgressBar: ({ current, total }: { current: number; total: number }) => {
    const { Text } = require('react-native');
    return <Text>{current}/{total}</Text>;
  },
}));

import FlashcardPlayerScreen from '@/app/study/flashcards/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('FlashcardPlayerScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseFlashcardSet.mockReturnValue({ data: undefined, isLoading: true });
    mockUseFlashcards.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<FlashcardPlayerScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows error state when set not found', () => {
    mockUseFlashcardSet.mockReturnValue({ data: null, isLoading: false });
    mockUseFlashcards.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<FlashcardPlayerScreen />, { wrapper: createWrapper() });
    expect(getByText(/not found/i)).toBeTruthy();
  });

  it('shows empty state when no flashcards', () => {
    mockUseFlashcardSet.mockReturnValue({ data: { id: 'fs-1', title: 'Test Set' }, isLoading: false });
    mockUseFlashcards.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<FlashcardPlayerScreen />, { wrapper: createWrapper() });
    expect(getByText(/No flashcards/i)).toBeTruthy();
  });

  it('renders flashcard player with cards', () => {
    mockUseFlashcardSet.mockReturnValue({ data: { id: 'fs-1', title: 'Test Set' }, isLoading: false });
    mockUseFlashcards.mockReturnValue({
      data: [
        { id: 'c-1', front: 'What is obligation?', back: 'A juridical necessity', cardType: 'definition' },
        { id: 'c-2', front: 'Art. 1156 elements', back: 'Active subject, passive subject...', cardType: 'elements' },
      ],
      isLoading: false,
    });
    const { getByText } = render(<FlashcardPlayerScreen />, { wrapper: createWrapper() });
    expect(getByText(/Card:/)).toBeTruthy();
  });

  it('shows study and review mode toggles', () => {
    mockUseFlashcardSet.mockReturnValue({ data: { id: 'fs-1', title: 'Test Set' }, isLoading: false });
    mockUseFlashcards.mockReturnValue({
      data: [{ id: 'c-1', front: 'Q', back: 'A', cardType: 'definition' }],
      isLoading: false,
    });
    const { getByText } = render(<FlashcardPlayerScreen />, { wrapper: createWrapper() });
    expect(getByText('Study')).toBeTruthy();
    expect(getByText('Review')).toBeTruthy();
  });
});
