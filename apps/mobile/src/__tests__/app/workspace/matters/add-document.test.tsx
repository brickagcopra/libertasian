import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ matterId: 'm-1' })),
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseSearch = jest.fn();
jest.mock('@/features/search/hooks/use-search', () => ({
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}));

jest.mock('@/features/camera-scan/hooks/use-uploads', () => ({
  useUploads: () => ({ data: { uploads: [] }, isLoading: false, fetchNextPage: jest.fn(), hasNextPage: false }),
}));

const mockAddMatterDocument = jest.fn().mockResolvedValue({});
jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useAddMatterDocument: () => ({ mutateAsync: mockAddMatterDocument, isPending: false }),
}));

import AddDocumentScreen from '@/app/workspace/matters/add-document';
import type { SearchResultItem } from '@/features/search/types';

/**
 * The API sets the OpenSearch `_id` to `section_id ?? document_id`
 * (opensearch.service.ts:511), so `item.id` is usually a SECTION uuid. Only
 * `source.document_id` is a legal document id.
 */
const sectionHit: SearchResultItem = {
  id: 'section-aaa',
  score: 5,
  source: {
    document_id: 'doc-aaa',
    title: 'People v. Reyes',
    document_type: 'decision',
    is_official: true,
    is_published: true,
    created_at: '2024-01-01T00:00:00Z',
    section_id: 'section-aaa',
  },
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AddDocumentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearch.mockReturnValue({ data: null, isLoading: false, refetch: jest.fn() });
  });

  it('renders role selector chips', () => {
    const { getByText } = render(<AddDocumentScreen />, { wrapper: createWrapper() });
    expect(getByText('Reference')).toBeTruthy();
    expect(getByText('Evidence')).toBeTruthy();
    expect(getByText('Pleading')).toBeTruthy();
    expect(getByText('Research')).toBeTruthy();
    expect(getByText('Note')).toBeTruthy();
  });

  it('renders source tabs', () => {
    const { getAllByText, getByText } = render(<AddDocumentScreen />, { wrapper: createWrapper() });
    // "Legal Documents" appears in the tab and also in the empty state text
    // "Search for legal documents to attach", so use getAllByText
    const legalDocsElements = getAllByText(/Legal Documents/i);
    expect(legalDocsElements.length).toBeGreaterThanOrEqual(1);
    expect(getByText('My Uploads')).toBeTruthy();
  });

  it('shows search empty state prompt', () => {
    const { getByText } = render(<AddDocumentScreen />, { wrapper: createWrapper() });
    expect(getByText('Search for legal documents to attach')).toBeTruthy();
  });

  it('renders document role label', () => {
    const { getByText } = render(<AddDocumentScreen />, { wrapper: createWrapper() });
    expect(getByText('Document Role')).toBeTruthy();
  });

  it('renders search input', () => {
    const { getByPlaceholderText } = render(<AddDocumentScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText('Search legal documents...')).toBeTruthy();
  });

  it('attaches the legal document id, not the OpenSearch section id', () => {
    mockUseSearch.mockReturnValue({
      data: { data: [sectionHit] },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByPlaceholderText, getByText } = render(<AddDocumentScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('Search legal documents...'), 'reyes');
    fireEvent.press(getByText('People v. Reyes'));

    expect(mockAddMatterDocument).toHaveBeenCalledWith(
      expect.objectContaining({ legalDocumentId: 'doc-aaa' }),
    );
  });
});
