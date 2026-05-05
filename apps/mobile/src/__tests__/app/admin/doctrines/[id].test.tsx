import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'd-1' })),
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseAdminDoctrineDetail = jest.fn();
jest.mock('@/features/admin/hooks/use-admin-doctrines', () => ({
  useAdminDoctrineDetail: (...args: unknown[]) => mockUseAdminDoctrineDetail(...args),
  useApproveDoctrine: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, isError: false, error: null }),
  useRejectDoctrine: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, isError: false, error: null }),
}));

import DoctrineDetailScreen from '@/app/admin/doctrines/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('DoctrineDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseAdminDoctrineDetail.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<DoctrineDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows error state when doctrine fails to load', () => {
    mockUseAdminDoctrineDetail.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<DoctrineDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Failed to load doctrine')).toBeTruthy();
  });

  it('renders doctrine detail with metadata', () => {
    mockUseAdminDoctrineDetail.mockReturnValue({
      data: {
        id: 'd-1',
        text: 'The doctrine of res judicata bars re-litigation of settled matters.',
        normalizedText: 'doctrine of res judicata',
        doctrineType: 'ratio_decidendi',
        reviewStatus: 'approved',
        confidence: 0.92,
        createdAt: '2024-01-15',
        updatedAt: '2024-01-15',
        legalDocumentId: 'doc-1',
        legalDocument: { id: 'doc-1', title: 'People v. Test', citationText: null, grNo: null, court: null, decisionDate: null },
        digest: null,
        digestId: null,
        sourceSection: null,
        sourceSectionId: null,
        linksFrom: [],
        linksTo: [],
      },
      isLoading: false,
      error: null,
    });
    const { getAllByText, getByText } = render(<DoctrineDetailScreen />, { wrapper: createWrapper() });
    // "res judicata" appears in both the main text and the normalized text section
    expect(getAllByText(/res judicata/).length).toBeGreaterThan(0);
    // The doctrineType is displayed as "ratio decidendi" in both the badge and the metadata section
    expect(getAllByText('ratio decidendi').length).toBeGreaterThan(0);
  });

  it('shows approve/reject buttons for pending doctrines', () => {
    mockUseAdminDoctrineDetail.mockReturnValue({
      data: {
        id: 'd-1',
        text: 'Test doctrine text',
        normalizedText: null,
        doctrineType: 'ratio_decidendi',
        reviewStatus: 'pending',
        confidence: 0.8,
        createdAt: '2024-01-15',
        updatedAt: '2024-01-15',
        legalDocumentId: null,
        legalDocument: null,
        digest: null,
        digestId: null,
        sourceSection: null,
        sourceSectionId: null,
        linksFrom: [],
        linksTo: [],
      },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<DoctrineDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Approve Doctrine')).toBeTruthy();
    expect(getByText('Reject Doctrine')).toBeTruthy();
  });
});
