import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseDigest = jest.fn();
jest.mock('../../features/digests/hooks/use-digests', () => ({
  useDigest: (...args: unknown[]) => mockUseDigest(...args),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { back: jest.fn(), push: jest.fn() },
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => {
      const { View } = require('react-native');
      return <View>{children}</View>;
    },
    {
      Screen: ({ options }: { options?: Record<string, unknown> }) => {
        const { Text } = require('react-native');
        return <Text testID="stack-screen">{String(options?.title ?? '')}</Text>;
      },
    },
  ),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import { router, useLocalSearchParams } from 'expo-router';
import DigestDetailScreen from './[id]';

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

describe('DigestDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'digest-123' });
  });

  it('shows loading state', () => {
    mockUseDigest.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    const { getByTestId } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByTestId('stack-screen')).toBeTruthy();
  });

  it('shows error state when digest not found', () => {
    mockUseDigest.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Not found'),
    });

    const { queryByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Digest not found')).toBeTruthy();
    expect(queryByText('Go Back')).toBeTruthy();
  });

  it('navigates back on Go Back press', () => {
    mockUseDigest.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Not found'),
    });

    const { getByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Go Back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('renders digest detail with all sections', () => {
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'People v. Reyes — Criminal Case Digest',
        digestType: 'case_digest',
        reviewStatus: 'approved',
        visibility: 'private',
        confidenceScore: 0.92,
        sourceOrigin: 'official_source',
        legalDocumentId: 'doc-456',
        createdAt: '2024-06-15T00:00:00Z',
        facts: 'The accused was charged with murder...',
        issues: 'Whether the prosecution proved guilt beyond reasonable doubt.',
        ruling: 'The Court affirmed the conviction.',
        doctrine: 'Circumstantial evidence sufficient when...',
        dispositive: 'WHEREFORE, the appeal is DISMISSED.',
      },
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    // Title
    expect(queryByText('People v. Reyes — Criminal Case Digest')).toBeTruthy();

    // Badges
    expect(queryByText('case digest')).toBeTruthy();
    expect(queryByText('approved')).toBeTruthy();
    expect(queryByText('private')).toBeTruthy();

    // Confidence
    expect(queryByText('92%')).toBeTruthy();

    // Sections
    expect(queryByText('Facts')).toBeTruthy();
    expect(queryByText('The accused was charged with murder...')).toBeTruthy();
    expect(queryByText('Issues')).toBeTruthy();
    expect(
      queryByText(
        'Whether the prosecution proved guilt beyond reasonable doubt.',
      ),
    ).toBeTruthy();
    expect(queryByText('Ruling')).toBeTruthy();
    expect(queryByText('Doctrine')).toBeTruthy();
    expect(queryByText('Dispositive Portion')).toBeTruthy();
    expect(
      queryByText('WHEREFORE, the appeal is DISMISSED.'),
    ).toBeTruthy();
  });

  it('shows View Source Document link when legalDocumentId exists', () => {
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'Test Digest',
        digestType: 'case_digest',
        reviewStatus: 'draft',
        visibility: 'private',
        confidenceScore: null,
        sourceOrigin: 'user_scan',
        legalDocumentId: 'doc-789',
        createdAt: '2024-01-01T00:00:00Z',
        facts: 'Some facts',
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('View Source Document'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc-789');
  });

  it('does not show View Source Document when no legalDocumentId', () => {
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'Test Digest',
        digestType: 'case_digest',
        reviewStatus: 'draft',
        visibility: 'private',
        confidenceScore: 0.5,
        sourceOrigin: 'user_scan',
        legalDocumentId: null,
        createdAt: '2024-01-01T00:00:00Z',
        facts: 'Facts here',
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('View Source Document')).toBeNull();
  });

  it('omits null digest sections', () => {
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'Partial Digest',
        digestType: 'case_digest',
        reviewStatus: 'ai_generated',
        visibility: 'private',
        confidenceScore: 0.6,
        sourceOrigin: 'user_scan',
        legalDocumentId: null,
        createdAt: '2024-01-01T00:00:00Z',
        facts: 'Only facts here',
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Facts')).toBeTruthy();
    expect(queryByText('Only facts here')).toBeTruthy();
    // Null sections should not render their labels
    expect(queryByText('Issues')).toBeNull();
    expect(queryByText('Ruling')).toBeNull();
    expect(queryByText('Doctrine')).toBeNull();
    expect(queryByText('Dispositive Portion')).toBeNull();
  });

  it('renders metadata row with source and date', () => {
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'Test',
        digestType: 'case_digest',
        reviewStatus: 'approved',
        visibility: 'public_editorial',
        confidenceScore: 0.8,
        sourceOrigin: 'official_source',
        legalDocumentId: null,
        createdAt: '2024-03-20T00:00:00Z',
        facts: 'Test facts',
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<DigestDetailScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Confidence')).toBeTruthy();
    expect(queryByText('80%')).toBeTruthy();
    expect(queryByText('Source')).toBeTruthy();
    expect(queryByText('official source')).toBeTruthy();
    expect(queryByText('Created')).toBeTruthy();
  });
});
