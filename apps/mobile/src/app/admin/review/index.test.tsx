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

const mockUseReviewQueue = jest.fn();
const mockUseReviewStats = jest.fn();
jest.mock('../../../features/admin/hooks/use-admin-review', () => ({
  useReviewQueue: (...args: unknown[]) => mockUseReviewQueue(...args),
  useReviewStats: () => mockUseReviewStats(),
}));

import ReviewQueueScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ReviewQueueScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReviewStats.mockReturnValue({
      data: {
        total: 10,
        byStatus: [{ status: 'pending_review', count: 3 }],
        bySourceOrigin: [],
        unassigned: 2,
        avgConfidence: 0.78,
        avgTimeToReviewHours: null,
        perReviewer: [],
      },
      isLoading: false,
      refetch: jest.fn(),
    });
  });

  it('shows loading state', () => {
    mockUseReviewQueue.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      refetch: jest.fn(),
    });
    const { UNSAFE_root } = render(<ReviewQueueScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state when no items', () => {
    mockUseReviewQueue.mockReturnValue({
      data: { items: [], meta: { hasMore: false, cursor: null, total: 0 } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewQueueScreen />, { wrapper: createWrapper() });
    expect(getByText(/No items in review queue/i)).toBeTruthy();
  });

  it('renders stat cards', () => {
    mockUseReviewQueue.mockReturnValue({
      data: { items: [], meta: { hasMore: false, cursor: null, total: 0 } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewQueueScreen />, { wrapper: createWrapper() });
    expect(getByText('10')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('renders review queue items', () => {
    mockUseReviewQueue.mockReturnValue({
      data: {
        items: [
          {
            id: 'r-1',
            title: 'People v. Cruz Digest',
            digestType: 'case_digest',
            reviewStatus: 'pending_review',
            sourceOrigin: 'ai_generated',
            confidenceScore: 0.85,
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
        meta: { hasMore: false, cursor: null, total: 1 },
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewQueueScreen />, { wrapper: createWrapper() });
    expect(getByText('People v. Cruz Digest')).toBeTruthy();
  });

  it('navigates to review detail on press', () => {
    mockUseReviewQueue.mockReturnValue({
      data: {
        items: [
          {
            id: 'r-1',
            title: 'Test Digest',
            digestType: 'case_digest',
            reviewStatus: 'pending_review',
            sourceOrigin: 'ai_generated',
            confidenceScore: 0.9,
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
        meta: { hasMore: false, cursor: null, total: 1 },
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ReviewQueueScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Test Digest'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalled();
  });
});
