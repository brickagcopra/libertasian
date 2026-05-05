import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseUploads = jest.fn();
jest.mock('@/features/camera-scan/hooks/use-uploads', () => ({
  useUploads: (...args: unknown[]) => mockUseUploads(...args),
}));

const mockUseQuotaUsage = jest.fn();
jest.mock('@/features/billing/hooks/use-quotas', () => ({
  useQuotaUsage: () => mockUseQuotaUsage(),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import { router } from 'expo-router';
import ScanTab from '@/app/(tabs)/scan';

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

describe('ScanTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuotaUsage.mockReturnValue({
      data: null,
    });
  });

  it('renders the scan CTA card', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });

    const { getByText, queryByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Scan Document')).toBeTruthy();
    expect(
      queryByText('Capture legal documents with your camera'),
    ).toBeTruthy();
    expect(getByText('Start Scan')).toBeTruthy();
  });

  it('navigates to capture screen on Start Scan', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });

    const { getByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Start Scan'));
    expect(router.push).toHaveBeenCalledWith('/scan/capture');
  });

  it('shows empty state when no scans', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });

    const { queryByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No scans yet')).toBeTruthy();
  });

  it('renders scan items with status badges', () => {
    mockUseUploads.mockReturnValue({
      data: {
        uploads: [
          {
            id: 'scan-1',
            originalFilename: 'court_decision.pdf',
            processingStatus: 'completed',
            createdAt: '2024-06-15T10:30:00Z',
          },
          {
            id: 'scan-2',
            originalFilename: 'receipt.jpg',
            processingStatus: 'processing',
            createdAt: '2024-06-15T11:00:00Z',
          },
          {
            id: 'scan-3',
            originalFilename: null,
            processingStatus: 'failed',
            createdAt: '2024-06-15T12:00:00Z',
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });

    const { queryByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('court_decision.pdf')).toBeTruthy();
    expect(queryByText('receipt.jpg')).toBeTruthy();
    expect(queryByText('Done')).toBeTruthy();
    expect(queryByText('Processing')).toBeTruthy();
    expect(queryByText('Failed')).toBeTruthy();
  });

  it('shows quota display when subscription has limits', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: {
          camera_scans_per_month: { limit: 20, used: 5 },
        },
      },
    });

    const { queryByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('5 / 20 scans this month')).toBeTruthy();
  });

  it('does not show quota for unlimited plans', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: {
          camera_scans_per_month: { limit: -1, used: 100 },
        },
      },
    });

    const { queryByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText(/scans this month/)).toBeNull();
  });

  it('shows section header for Recent Scans', () => {
    mockUseUploads.mockReturnValue({
      data: { uploads: [] },
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });

    const { getByText } = render(<ScanTab />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Recent Scans')).toBeTruthy();
  });
});
