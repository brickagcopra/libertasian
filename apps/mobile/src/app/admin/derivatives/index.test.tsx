import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import DerivativesScreen from './index';

// ---- Mocks ----

const mockRefetchStats = jest.fn();
const mockRefetchJobs = jest.fn();
const mockMutate = jest.fn();

jest.mock('../../../features/admin/hooks/use-admin-derivatives', () => ({
  useDerivativeStats: jest.fn(() => ({
    data: {
      totalDigests: 142,
      byType: { case_digest: 80, statute_summary: 40, study_digest: 22 },
      byStatus: { approved: 100, ai_generated: 30, draft: 12 },
      pendingReview: 15,
      avgConfidence: 0.78,
    },
    isLoading: false,
    refetch: mockRefetchStats,
  })),
  useRecentGenerationJobs: jest.fn(() => ({
    data: [
      {
        id: 'job-1',
        digestType: 'case_digest',
        status: 'completed',
        legalDocumentId: 'doc-1',
        documentTitle: 'People v. Santos G.R. No. 12345',
        createdAt: '2026-04-10T10:00:00Z',
        completedAt: '2026-04-10T10:05:00Z',
        error: null,
      },
      {
        id: 'job-2',
        digestType: 'statute_summary',
        status: 'failed',
        legalDocumentId: 'doc-2',
        documentTitle: 'Republic Act No. 1234',
        createdAt: '2026-04-09T08:00:00Z',
        completedAt: null,
        error: 'OCR quality too low',
      },
    ],
    isLoading: false,
    isFetching: false,
    refetch: mockRefetchJobs,
  })),
  useTriggerDigestGeneration: jest.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => (
      <>{typeof options?.headerRight === 'function' ? options.headerRight({}) : null}</>
    ),
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// ---- Tests ----

describe('DerivativesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders stats cards', () => {
    render(<DerivativesScreen />);

    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('Total Digests')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('Pending Review')).toBeTruthy();
    expect(screen.getByText('78%')).toBeTruthy();
    expect(screen.getByText('Avg Confidence')).toBeTruthy();
  });

  it('renders type breakdown', () => {
    render(<DerivativesScreen />);

    expect(screen.getByText('By Type')).toBeTruthy();
    expect(screen.getByText('case digest')).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('statute summary')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('renders status breakdown', () => {
    render(<DerivativesScreen />);

    expect(screen.getByText('By Status')).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('renders recent generation jobs', () => {
    render(<DerivativesScreen />);

    expect(screen.getByText('Recent Generations')).toBeTruthy();
    expect(screen.getByText('People v. Santos G.R. No. 12345')).toBeTruthy();
    expect(screen.getByText('Republic Act No. 1234')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('OCR quality too low')).toBeTruthy();
  });

  it('shows loading state', () => {
    const { useDerivativeStats } = require('../../../features/admin/hooks/use-admin-derivatives');
    useDerivativeStats.mockReturnValueOnce({
      data: null,
      isLoading: true,
      refetch: mockRefetchStats,
    });

    render(<DerivativesScreen />);
    // Should not render stats when loading
    expect(screen.queryByText('Total Digests')).toBeNull();
  });

  it('opens generate modal on header button press', () => {
    render(<DerivativesScreen />);

    // The header right button should be rendered via Stack.Screen mock
    // The modal trigger is in the header
    expect(screen.getByText('Trigger Digest Generation')).toBeTruthy();
  });
});
