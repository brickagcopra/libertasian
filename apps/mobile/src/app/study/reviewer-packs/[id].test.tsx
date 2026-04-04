import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'rp-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseReviewerPack = jest.fn();
jest.mock('../../../features/study/hooks/use-reviewer-packs', () => ({
  useReviewerPack: (...args: unknown[]) => mockUseReviewerPack(...args),
  useDeleteReviewerPackItem: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/study/hooks/use-study-export', () => ({
  useExportReviewerPack: () => ({ mutate: jest.fn(), isPending: false }),
}));

import ReviewerPackDetailScreen from './[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ReviewerPackDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseReviewerPack.mockReturnValue({ data: undefined, isLoading: true, isFetching: false, refetch: jest.fn() });
    const { UNSAFE_root } = render(<ReviewerPackDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows not found state', () => {
    mockUseReviewerPack.mockReturnValue({ data: null, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ReviewerPackDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/not found/i)).toBeTruthy();
  });

  it('renders pack details with items', () => {
    mockUseReviewerPack.mockReturnValue({
      data: {
        id: 'rp-1',
        title: 'Criminal Law Review',
        description: 'Essential cases for crim law',
        barSubject: 'criminal_law',
        itemCount: 2,
        items: [
          {
            id: 'item-1',
            itemType: 'legal_document',
            legalDocument: { id: 'ld-1', title: 'People v. Smith', grNo: '12345' },
            digest: null,
            section: null,
            note: null,
          },
          {
            id: 'item-2',
            itemType: 'digest',
            legalDocument: null,
            digest: { id: 'd-1', title: 'Digest of People v. Smith', digestType: 'case_digest' },
            section: null,
            note: null,
          },
        ],
        creator: { fullName: 'Juan Dela Cruz' },
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewerPackDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Essential cases for crim law')).toBeTruthy();
    expect(getByText('People v. Smith')).toBeTruthy();
  });

  it('navigates back on Go Back in not found state', () => {
    mockUseReviewerPack.mockReturnValue({ data: null, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ReviewerPackDetailScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Go Back'));
    const { router } = require('expo-router');
    expect(router.back).toHaveBeenCalled();
  });
});
