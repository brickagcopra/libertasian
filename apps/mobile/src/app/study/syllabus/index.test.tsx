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

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
  Circle: () => null,
}));

const mockUseSyllabi = jest.fn();
const mockUseBarExamReadiness = jest.fn();
jest.mock('../../../features/study/hooks/use-syllabus', () => ({
  useSyllabi: () => mockUseSyllabi(),
  useBarExamReadiness: () => mockUseBarExamReadiness(),
}));

jest.mock('../../../features/study/components/readiness-ring', () => ({
  ReadinessRing: ({ pct }: { pct: number }) => {
    const { Text } = require('react-native');
    return <Text testID="readiness-ring">{pct}%</Text>;
  },
}));

import SyllabusListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('SyllabusListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBarExamReadiness.mockReturnValue({ data: undefined, refetch: jest.fn() });
  });

  it('shows loading state', () => {
    mockUseSyllabi.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { UNSAFE_root } = render(<SyllabusListScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state when no syllabi', () => {
    mockUseSyllabi.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No syllabi available/i)).toBeTruthy();
  });

  it('renders syllabus cards', () => {
    mockUseSyllabi.mockReturnValue({
      data: [
        {
          id: 'syl-1',
          barSubjectCode: 'civil_law',
          title: 'Civil Law Syllabus',
          topicCount: 15,
          ordering: 1,
          isActive: true,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
        {
          id: 'syl-2',
          barSubjectCode: 'criminal_law',
          title: 'Criminal Law Syllabus',
          topicCount: 12,
          ordering: 2,
          isActive: true,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusListScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil Law Syllabus')).toBeTruthy();
    expect(getByText('Criminal Law Syllabus')).toBeTruthy();
  });

  it('navigates to subject on card press', () => {
    mockUseSyllabi.mockReturnValue({
      data: [
        {
          id: 'syl-1',
          barSubjectCode: 'civil_law',
          title: 'Civil Law Syllabus',
          topicCount: 15,
          ordering: 1,
          isActive: true,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusListScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Civil Law Syllabus'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/study/syllabus/civil_law');
  });

  it('shows readiness ring when data available', () => {
    mockUseSyllabi.mockReturnValue({
      data: [
        {
          id: 'syl-1',
          barSubjectCode: 'civil_law',
          title: 'Civil Law Syllabus',
          topicCount: 10,
          ordering: 1,
          isActive: true,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockUseBarExamReadiness.mockReturnValue({
      data: {
        overallPct: 42,
        totalTopics: 100,
        completedTopics: 42,
        subjects: [{ barSubjectCode: 'civil_law', title: 'Civil Law', totalTopics: 10, completedTopics: 4, pct: 40 }],
      },
      refetch: jest.fn(),
    });
    const { getByText } = render(<SyllabusListScreen />, { wrapper: createWrapper() });
    expect(getByText('Bar Exam Readiness')).toBeTruthy();
    expect(getByText(/42 of 100 topics completed/)).toBeTruthy();
  });
});
