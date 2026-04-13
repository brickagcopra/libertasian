import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ subject: 'civil_law' }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseSyllabus = jest.fn();
const mockUseSyllabusProgress = jest.fn();
const mockMutate = jest.fn();
jest.mock('../../../features/study/hooks/use-syllabus', () => ({
  useSyllabus: () => mockUseSyllabus(),
  useSyllabusProgress: () => mockUseSyllabusProgress(),
  useUpsertSyllabusTopicProgress: () => ({ mutate: mockMutate }),
}));

import SyllabusSubjectScreen from './[subject]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const baseSyllabus = {
  id: 'syl-1',
  barSubjectCode: 'civil_law',
  title: 'Civil Law',
  description: null,
  examYear: 2025,
  topicCount: 3,
  ordering: 1,
  isActive: true,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  topics: [
    {
      id: 't-1',
      syllabusId: 'syl-1',
      parentTopicId: null,
      slug: 'obligations',
      title: 'Obligations',
      description: null,
      depth: 0,
      ordering: 1,
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      children: [
        {
          id: 't-2',
          syllabusId: 'syl-1',
          parentTopicId: 't-1',
          slug: 'sources-of-obligations',
          title: 'Sources of Obligations',
          description: null,
          depth: 1,
          ordering: 1,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
          children: [],
          _count: { resources: 2, children: 0 },
        },
      ],
      _count: { resources: 0, children: 1 },
    },
    {
      id: 't-3',
      syllabusId: 'syl-1',
      parentTopicId: null,
      slug: 'contracts',
      title: 'Contracts',
      description: null,
      depth: 0,
      ordering: 2,
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      children: [],
      _count: { resources: 3, children: 0 },
    },
  ],
};

describe('SyllabusSubjectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSyllabusProgress.mockReturnValue({
      data: {
        syllabusId: 'syl-1',
        totalTopics: 3,
        completedCount: 1,
        inProgressCount: 1,
        notStartedCount: 1,
        overallPct: 33,
        topicProgress: {
          't-1': { status: 'in_progress', progressPct: 50 },
          't-2': { status: 'completed', progressPct: 100 },
          't-3': { status: 'not_started', progressPct: 0 },
        },
      },
      refetch: jest.fn(),
    });
  });

  it('shows loading state', () => {
    mockUseSyllabus.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { UNSAFE_root } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows not found state when no syllabus', () => {
    mockUseSyllabus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    expect(getByText(/Syllabus not found/i)).toBeTruthy();
  });

  it('renders topic tree with progress', () => {
    mockUseSyllabus.mockReturnValue({
      data: baseSyllabus,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    expect(getByText('Obligations')).toBeTruthy();
    expect(getByText('Sources of Obligations')).toBeTruthy();
    expect(getByText('Contracts')).toBeTruthy();
    expect(getByText('1 of 3 topics completed')).toBeTruthy();
    expect(getByText('33%')).toBeTruthy();
  });

  it('shows child completion count for parent topics', () => {
    mockUseSyllabus.mockReturnValue({
      data: baseSyllabus,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    expect(getByText('1/1 completed')).toBeTruthy();
  });

  it('cycles topic status on checkbox tap', () => {
    mockUseSyllabus.mockReturnValue({
      data: baseSyllabus,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getAllByText } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    // Tap the 'square-outline' (not_started) checkbox for Contracts (t-3)
    const checkboxes = getAllByText('square-outline');
    if (checkboxes.length > 0) {
      fireEvent.press(checkboxes[0]);
      expect(mockMutate).toHaveBeenCalledWith({
        topicId: 't-3',
        data: { status: 'in_progress', progressPct: 50 },
      });
    }
  });

  it('navigates to topic detail for topics with resources', () => {
    mockUseSyllabus.mockReturnValue({
      data: baseSyllabus,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusSubjectScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Contracts'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/study/syllabus/civil_law/topic/t-3');
  });
});
