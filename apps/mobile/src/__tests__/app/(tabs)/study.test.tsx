import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseBarSubjects = jest.fn();
jest.mock('@/features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: () => mockUseBarSubjects(),
}));

const mockUseFlashcardSets = jest.fn();
jest.mock('@/features/study/hooks/use-flashcard-sets', () => ({
  useFlashcardSets: (...args: unknown[]) => mockUseFlashcardSets(...args),
}));

const mockUseReviewerPacks = jest.fn();
jest.mock('@/features/study/hooks/use-reviewer-packs', () => ({
  useReviewerPacks: (...args: unknown[]) => mockUseReviewerPacks(...args),
}));

jest.mock('@/features/study/components/subject-grid', () => ({
  SubjectGrid: ({ subjects }: { subjects: unknown[] }) => {
    const { Text } = require('react-native');
    return <Text testID="subject-grid">{subjects.length} subjects</Text>;
  },
}));

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

import StudyTab from '@/app/(tabs)/study';

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

describe('StudyTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state while subjects load', () => {
    mockUseBarSubjects.mockReturnValue({
      data: null,
      isLoading: true,
      isFetching: true,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: null,
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: null,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    // When loading, content sections should not render
    expect(queryByText('Bar Subjects')).toBeNull();
  });

  it('renders stats row with counts', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: { data: [{ id: 'f1' }, { id: 'f2' }] },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: { data: [{ id: 'r1' }] },
      refetch: jest.fn(),
    });

    const { getByText, getAllByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('3')).toBeTruthy(); // subjects count
    expect(getByText('2')).toBeTruthy(); // flashcard sets count
    expect(getByText('1')).toBeTruthy(); // reviewer packs count
    expect(getByText('Subjects')).toBeTruthy();
    // "Flashcard Sets" and "Reviewer Packs" appear in both stats and section headers
    expect(getAllByText('Flashcard Sets').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText('Reviewer Packs').length).toBeGreaterThanOrEqual(2);
  });

  it('renders community marketplace banner', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });

    const { queryByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Community Marketplace')).toBeTruthy();
    expect(
      queryByText('Discover shared flashcards, reviewers & digests'),
    ).toBeTruthy();
  });

  it('renders section headers with See All links', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });

    const { getByText, getAllByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Bar Subjects')).toBeTruthy();
    expect(getAllByText('Flashcard Sets').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Reviewer Packs').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('See All').length).toBe(3);
  });

  it('shows empty states when no data', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });

    const { queryByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No bar subjects available')).toBeTruthy();
    expect(queryByText('No flashcard sets yet')).toBeTruthy();
    expect(queryByText('No reviewer packs yet')).toBeTruthy();
  });

  it('renders flashcard set list items', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: {
        data: [
          {
            id: 'fs1',
            title: 'Constitutional Law Set',
            cardCount: 25,
            barSubject: 'political_law',
          },
        ],
      },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });

    const { queryByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Constitutional Law Set')).toBeTruthy();
    expect(queryByText(/25 cards/)).toBeTruthy();
  });

  it('renders reviewer pack list items', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseFlashcardSets.mockReturnValue({
      data: { data: [] },
      refetch: jest.fn(),
    });
    mockUseReviewerPacks.mockReturnValue({
      data: {
        data: [
          {
            id: 'rp1',
            title: 'Evidence Reviewer',
            itemCount: 12,
            barSubject: 'remedial_law',
          },
        ],
      },
      refetch: jest.fn(),
    });

    const { queryByText } = render(<StudyTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Evidence Reviewer')).toBeTruthy();
    expect(queryByText(/12 items/)).toBeTruthy();
  });
});
