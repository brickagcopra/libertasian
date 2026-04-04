import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'r-1' })),
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseReviewQueue = jest.fn();
jest.mock('../../../features/admin/hooks/use-admin-review', () => ({
  useReviewQueue: (...args: unknown[]) => mockUseReviewQueue(...args),
  useSubmitReview: () => ({ mutate: jest.fn(), isPending: false }),
  useUnassignReviewer: () => ({ mutate: jest.fn(), isPending: false }),
}));

import ReviewDetailScreen from './[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ReviewDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseReviewQueue.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { UNSAFE_root } = render(<ReviewDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows not found state', () => {
    mockUseReviewQueue.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Digest not found')).toBeTruthy();
  });

  it('renders review detail with digest info', () => {
    mockUseReviewQueue.mockReturnValue({
      data: {
        items: [
          {
            id: 'r-1',
            title: 'People v. Smith Digest',
            digestType: 'case_digest',
            reviewStatus: 'pending_review',
            sourceOrigin: 'ai_generated',
            confidenceScore: 0.87,
            visibility: 'private',
            assignedReviewerUserId: null,
            userId: null,
            organizationId: null,
            createdAt: '2024-06-01',
            updatedAt: '2024-06-01',
            legalDocument: { id: 'doc-1', title: 'People v. Smith', shortTitle: null, citationText: null, grNo: null, court: null, decisionDate: null, documentType: 'case_law' },
            assignedReviewer: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getAllByText } = render(<ReviewDetailScreen />, { wrapper: createWrapper() });
    // Title appears in both the main title and the Facts collapsible section content
    expect(getAllByText('People v. Smith Digest').length).toBeGreaterThan(0);
  });

  it('shows action buttons for reviewable items', () => {
    mockUseReviewQueue.mockReturnValue({
      data: {
        items: [
          {
            id: 'r-1',
            title: 'Test Digest',
            digestType: 'case_digest',
            reviewStatus: 'pending_review',
            sourceOrigin: 'ai_generated',
            confidenceScore: 0.87,
            visibility: 'private',
            assignedReviewerUserId: null,
            userId: null,
            organizationId: null,
            createdAt: '2024-06-01',
            updatedAt: '2024-06-01',
            legalDocument: null,
            assignedReviewer: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Reject')).toBeTruthy();
  });
});
