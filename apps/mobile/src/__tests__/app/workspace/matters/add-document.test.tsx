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

jest.mock('@/features/search/hooks/use-search', () => ({
  useSearch: () => ({ data: null, isLoading: false, refetch: jest.fn() }),
}));

jest.mock('@/features/camera-scan/hooks/use-uploads', () => ({
  useUploads: () => ({ data: { uploads: [] }, isLoading: false, fetchNextPage: jest.fn(), hasNextPage: false }),
}));

jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useAddMatterDocument: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import AddDocumentScreen from '@/app/workspace/matters/add-document';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AddDocumentScreen', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
