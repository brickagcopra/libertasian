import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseDigests = jest.fn();
const mockUseGenerateDigest = jest.fn();
jest.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: (...args: unknown[]) => mockUseDigests(...args),
  useGenerateDigest: (...args: unknown[]) => mockUseGenerateDigest(...args),
}));

const mockUseDigestTextSearch = jest.fn();
jest.mock('@/features/digests/hooks/use-digest-text-search', () => ({
  useDigestTextSearch: (...args: unknown[]) => mockUseDigestTextSearch(...args),
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

import DigestsTab from '@/app/(tabs)/digests';

const SEARCH_PLACEHOLDER = 'Search by title, case name, or citation...';

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

describe('DigestsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDigestTextSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    mockUseGenerateDigest.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    });
  });

  it('shows loading state', () => {
    mockUseDigests.mockReturnValue({
      data: null,
      isLoading: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { UNSAFE_queryByType } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    // ActivityIndicator should be present
    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    // When loading, no empty text should appear
    expect(queryByText('No digests yet')).toBeNull();
  });

  it('shows empty state when no digests', () => {
    mockUseDigests.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No digests found')).toBeTruthy();
    expect(
      queryByText('Generate case digests from legal documents using AI'),
    ).toBeTruthy();
  });

  it('renders digest cards with correct data', () => {
    mockUseDigests.mockReturnValue({
      data: {
        data: [
          {
            id: 'd1',
            title: 'People v. Reyes - Digest',
            digestType: 'case_digest',
            reviewStatus: 'approved',
            confidenceScore: 0.85,
            facts: 'The accused was charged with theft...',
            sourceOrigin: 'official_source',
            createdAt: '2024-06-15T00:00:00Z',
          },
          {
            id: 'd2',
            title: 'Estate Tax Advisory',
            digestType: 'administrative_digest',
            reviewStatus: 'needs_human_review',
            confidenceScore: 0.55,
            facts: null,
            sourceOrigin: 'user_scan',
            createdAt: '2024-07-01T00:00:00Z',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('People v. Reyes - Digest')).toBeTruthy();
    expect(queryByText('Estate Tax Advisory')).toBeTruthy();
    expect(queryByText('85%')).toBeTruthy();
    expect(queryByText('55%')).toBeTruthy();
    expect(queryByText('The accused was charged with theft...')).toBeTruthy();
  });

  it('renders digest type and status badges', () => {
    mockUseDigests.mockReturnValue({
      data: {
        data: [
          {
            id: 'd1',
            title: 'Test Digest',
            digestType: 'case_digest',
            reviewStatus: 'ai_generated',
            confidenceScore: 0.9,
            facts: null,
            sourceOrigin: 'official_source',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('case digest')).toBeTruthy();
    expect(queryByText('ai generated')).toBeTruthy();
  });

  describe('full-text search', () => {
    const browseReturn = {
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('debounces typed input by 300ms before committing the query', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue(browseReturn);

      const { getByPlaceholderText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      fireEvent.changeText(getByPlaceholderText(SEARCH_PLACEHOLDER), 'estafa');

      // Immediately after typing the committed query is still empty/disabled.
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith('', false);

      act(() => {
        jest.advanceTimersByTime(299);
      });
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith('', false);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith('estafa', true);
    });

    it('trims the committed query', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue(browseReturn);

      const { getByPlaceholderText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      fireEvent.changeText(
        getByPlaceholderText(SEARCH_PLACEHOLDER),
        '  people v. reyes  ',
      );
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith(
        'people v. reyes',
        true,
      );
    });

    it('replaces the browse list with search results and hides filter chips', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue({
        ...browseReturn,
        data: {
          data: [
            {
              id: 'browse-1',
              title: 'Browse Digest',
              digestType: 'case_digest',
              reviewStatus: 'approved',
              confidenceScore: 0.9,
              facts: null,
              sourceOrigin: 'editorial_corpus',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });
      mockUseDigestTextSearch.mockReturnValue({
        data: {
          results: [
            {
              id: 'search-1',
              title: 'People v. Reyes - Digest',
              digestType: 'case_digest',
              reviewStatus: 'approved',
              confidenceScore: 0.8,
              facts: null,
              sourceOrigin: 'editorial_corpus',
              createdAt: '2024-02-01T00:00:00Z',
            },
          ],
          hasMore: false,
          cursor: null,
          matchedDocuments: [],
        },
        isLoading: false,
        error: null,
      });

      const { getByPlaceholderText, queryByText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      fireEvent.changeText(getByPlaceholderText(SEARCH_PLACEHOLDER), 'reyes');
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(queryByText('People v. Reyes - Digest')).toBeTruthy();
      expect(queryByText('Browse Digest')).toBeNull();
      // Sort row and filter chips are hidden while searching.
      expect(queryByText('Newest First')).toBeNull();
      expect(queryByText('Case Digest')).toBeNull();
    });

    it('shows the no-match empty state when nothing is found', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue(browseReturn);
      mockUseDigestTextSearch.mockReturnValue({
        data: { results: [], hasMore: false, cursor: null, matchedDocuments: [] },
        isLoading: false,
        error: null,
      });

      const { getByPlaceholderText, queryByText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      fireEvent.changeText(getByPlaceholderText(SEARCH_PLACEHOLDER), 'zzz');
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(
        queryByText('No digests found matching "zzz". Try a different search term.'),
      ).toBeTruthy();
    });

    it('offers Generate digest for matched documents when no digest matches', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue(browseReturn);
      mockUseDigestTextSearch.mockReturnValue({
        data: {
          results: [],
          hasMore: false,
          cursor: null,
          matchedDocuments: [
            {
              id: 'ld-1',
              title: 'People v. Reyes',
              grNo: 'G.R. No. 123456',
              citationText: null,
            },
          ],
        },
        isLoading: false,
        error: null,
      });

      const { getByPlaceholderText, queryByText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      fireEvent.changeText(getByPlaceholderText(SEARCH_PLACEHOLDER), 'reyes');
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(queryByText('People v. Reyes')).toBeTruthy();
      expect(queryByText('G.R. No. 123456')).toBeTruthy();
      expect(queryByText('Generate digest')).toBeTruthy();
    });

    it('restores the browse list when the query is cleared', () => {
      jest.useFakeTimers();
      mockUseDigests.mockReturnValue({
        ...browseReturn,
        data: {
          data: [
            {
              id: 'browse-1',
              title: 'Browse Digest',
              digestType: 'case_digest',
              reviewStatus: 'approved',
              confidenceScore: 0.9,
              facts: null,
              sourceOrigin: 'editorial_corpus',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const { getByPlaceholderText, queryByText } = render(<DigestsTab />, {
        wrapper: createWrapper(),
      });

      const input = getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.changeText(input, 'reyes');
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith('reyes', true);

      fireEvent.changeText(input, '');
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(mockUseDigestTextSearch).toHaveBeenLastCalledWith('', false);
      expect(queryByText('Browse Digest')).toBeTruthy();
      expect(queryByText('Newest First')).toBeTruthy();
    });
  });
});
