import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ subject: 'civil_law', topicId: 't-2' }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseSyllabus = jest.fn();
const mockUseSyllabusTopic = jest.fn();
jest.mock('../../../../../features/study/hooks/use-syllabus', () => ({
  useSyllabus: () => mockUseSyllabus(),
  useSyllabusTopic: () => mockUseSyllabusTopic(),
}));

import TopicDetailScreen from './[topicId]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('TopicDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseSyllabus.mockReturnValue({ data: undefined, isLoading: true });
    mockUseSyllabusTopic.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows not found state when topic missing', () => {
    mockUseSyllabus.mockReturnValue({ data: { id: 'syl-1' }, isLoading: false });
    mockUseSyllabusTopic.mockReturnValue({ data: undefined, isLoading: false });
    const { getByText } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/Topic not found/i)).toBeTruthy();
  });

  it('renders topic with resources', () => {
    mockUseSyllabus.mockReturnValue({ data: { id: 'syl-1' }, isLoading: false });
    mockUseSyllabusTopic.mockReturnValue({
      data: {
        id: 't-2',
        syllabusId: 'syl-1',
        parentTopicId: 't-1',
        slug: 'sources-of-obligations',
        title: 'Sources of Obligations',
        description: 'Study the sources of obligations under the Civil Code.',
        depth: 1,
        ordering: 1,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        parent: { id: 't-1', title: 'Obligations', slug: 'obligations' },
        resources: [
          {
            id: 'r-1',
            topicId: 't-2',
            resourceType: 'legal_document',
            resourceId: 'doc-1',
            title: 'Civil Code of the Philippines',
            note: null,
            ordering: 1,
            createdAt: '2025-01-01',
          },
          {
            id: 'r-2',
            topicId: 't-2',
            resourceType: 'digest',
            resourceId: 'dig-1',
            title: 'Digest: Obligations Overview',
            note: 'Key digest',
            ordering: 2,
            createdAt: '2025-01-01',
          },
        ],
      },
      isLoading: false,
    });
    const { getByText } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Sources of Obligations')).toBeTruthy();
    expect(getByText(/Study the sources/)).toBeTruthy();
    expect(getByText('Civil Code of the Philippines')).toBeTruthy();
    expect(getByText('Digest: Obligations Overview')).toBeTruthy();
    expect(getByText('Obligations')).toBeTruthy(); // parent breadcrumb
    expect(getByText('Linked Resources (2)')).toBeTruthy();
  });

  it('navigates to legal document on resource press', () => {
    mockUseSyllabus.mockReturnValue({ data: { id: 'syl-1' }, isLoading: false });
    mockUseSyllabusTopic.mockReturnValue({
      data: {
        id: 't-2',
        syllabusId: 'syl-1',
        parentTopicId: null,
        slug: 'test',
        title: 'Test Topic',
        description: null,
        depth: 0,
        ordering: 1,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        resources: [
          {
            id: 'r-1',
            topicId: 't-2',
            resourceType: 'legal_document',
            resourceId: 'doc-1',
            title: 'Civil Code',
            note: null,
            ordering: 1,
            createdAt: '2025-01-01',
          },
        ],
      },
      isLoading: false,
    });
    const { getByText } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Civil Code'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/reader/doc-1');
  });

  it('navigates to digest on resource press', () => {
    mockUseSyllabus.mockReturnValue({ data: { id: 'syl-1' }, isLoading: false });
    mockUseSyllabusTopic.mockReturnValue({
      data: {
        id: 't-2',
        syllabusId: 'syl-1',
        parentTopicId: null,
        slug: 'test',
        title: 'Test Topic',
        description: null,
        depth: 0,
        ordering: 1,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        resources: [
          {
            id: 'r-2',
            topicId: 't-2',
            resourceType: 'digest',
            resourceId: 'dig-1',
            title: 'Obligations Digest',
            note: null,
            ordering: 1,
            createdAt: '2025-01-01',
          },
        ],
      },
      isLoading: false,
    });
    const { getByText } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Obligations Digest'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/digest/dig-1');
  });

  it('shows empty state when no resources', () => {
    mockUseSyllabus.mockReturnValue({ data: { id: 'syl-1' }, isLoading: false });
    mockUseSyllabusTopic.mockReturnValue({
      data: {
        id: 't-2',
        syllabusId: 'syl-1',
        parentTopicId: null,
        slug: 'empty',
        title: 'Empty Topic',
        description: null,
        depth: 0,
        ordering: 1,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        resources: [],
      },
      isLoading: false,
    });
    const { getByText } = render(<TopicDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/No resources linked/i)).toBeTruthy();
  });
});
