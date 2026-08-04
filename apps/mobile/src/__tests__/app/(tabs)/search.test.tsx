import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SearchResultItem } from '@/features/search/types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

const mockUseSearch = jest.fn();
jest.mock('@/features/search/hooks/use-search', () => ({
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}));

jest.mock('@/features/search/hooks/use-search-history', () => ({
  useSearchHistory: () => ({
    history: [],
    addEntry: jest.fn(),
    removeEntry: jest.fn(),
    clearHistory: jest.fn(),
  }),
}));

jest.mock('@/features/documents/hooks/use-recently-viewed', () => ({
  useRecentlyViewed: () => ({ recentlyViewed: [] }),
}));

const mockGenerateDigest = jest.fn();
jest.mock('@/features/digests/hooks/use-digests', () => ({
  useGenerateDigest: () => ({ mutateAsync: mockGenerateDigest, isPending: false }),
}));

const mockUseDigestCount = jest.fn();
jest.mock('@/features/search/hooks/use-search-digests', () => ({
  useDigestCount: (...args: unknown[]) => mockUseDigestCount(...args),
  useSearchDigests: () => ({ data: undefined, isLoading: false, error: null }),
}));

import { router } from 'expo-router';
import SearchRoute from '@/app/(tabs)/search';

const SEARCH_PLACEHOLDER = 'Search cases, articles, statutes…';

/**
 * The API sets the OpenSearch `_id` to `section_id ?? document_id`
 * (opensearch.service.ts:511), so a section-level hit — the common case — has
 * an `id` that is NOT a legal document id. Every fixture here reproduces that.
 */
const sectionHit: SearchResultItem = {
  id: 'section-aaa',
  score: 9.1,
  source: {
    document_id: 'doc-aaa',
    title: 'People v. Reyes',
    short_title: 'People v. Reyes',
    citation_text: 'G.R. No. 123456',
    document_type: 'decision',
    is_official: true,
    is_published: true,
    created_at: '2024-01-01T00:00:00Z',
    section_id: 'section-aaa',
  },
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function renderWithQuery() {
  const utils = render(<SearchRoute />, { wrapper: createWrapper() });
  const input = utils.getByPlaceholderText(SEARCH_PLACEHOLDER);
  fireEvent.changeText(input, 'reyes');
  fireEvent(input, 'submitEditing');
  return utils;
}

describe('SearchRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDigestCount.mockReturnValue({ data: undefined, isLoading: false, error: null });
    mockUseSearch.mockReturnValue({ data: { data: [sectionHit] }, isLoading: false });
  });

  it('opens the reader with the legal document id, not the OpenSearch section id', () => {
    const { getByText } = renderWithQuery();

    fireEvent.press(getByText('People v. Reyes'));

    expect(router.push).toHaveBeenCalledWith('/reader/doc-aaa');
    expect(router.push).not.toHaveBeenCalledWith('/reader/section-aaa');
  });

  it('generates a digest against the legal document id', () => {
    const { getByLabelText } = renderWithQuery();

    fireEvent.press(getByLabelText('Generate digest'));

    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    buttons.find((b) => b.text === 'Generate')?.onPress?.();

    expect(mockGenerateDigest).toHaveBeenCalledWith({
      legalDocumentId: 'doc-aaa',
      digestType: 'case_digest',
    });
  });

  // The Digests tab searches the case-digest corpus by TEXT now. It used to be
  // fed the ids of whatever documents the full-text arm returned, which meant a
  // digest was only reachable if its source decision ranked for the same query.
  it('feeds the digests tab the query string, not document ids', () => {
    renderWithQuery();

    expect(mockUseDigestCount).toHaveBeenLastCalledWith('reyes', true);
  });
});
