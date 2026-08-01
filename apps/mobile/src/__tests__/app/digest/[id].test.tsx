import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseDigest = jest.fn();
jest.mock('@/features/digests/hooks/use-digests', () => ({
  useDigest: (...args: unknown[]) => mockUseDigest(...args),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: {
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
}));

import { router, useLocalSearchParams } from 'expo-router';
import { ApiClientError } from '@/lib/api-client';
import DigestDetailRoute from '@/app/digest/[id]';

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

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'digest-123' });
});

describe('DigestDetailRoute (Phase 3 DigestDetailScreen)', () => {
  it('shows the not-found state when the digest fails to load', () => {
    mockUseDigest.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    expect(getByText('Digest not found')).toBeTruthy();
  });

  it('shows the premium state on a 402 ApiClientError', () => {
    mockUseDigest.mockReturnValue({
      data: null,
      isLoading: false,
      error: new ApiClientError(402, 'Payment required'),
    });
    const { getByText, queryByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    expect(getByText('Premium digest')).toBeTruthy();
    expect(
      getByText('Full case digests are not included in your plan.'),
    ).toBeTruthy();
    // No purchase steering (Apple 3.1.1 / Play Payments).
    expect(queryByText(/Upgrade/i)).toBeNull();
    expect(queryByText('Digest not found')).toBeNull();
  });

  it('keeps the not-found copy for non-402 ApiClientErrors', () => {
    mockUseDigest.mockReturnValue({
      data: null,
      isLoading: false,
      error: new ApiClientError(404, 'Not found'),
    });
    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    expect(getByText('Digest not found')).toBeTruthy();
  });

  it('navigates back from the error state when history exists', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(true);
    mockUseDigest.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Go back'));
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to the tabs root when there is no history to go back to', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    mockUseDigest.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Go back'));
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('renders headline + eyebrow + tldr + sections', () => {
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
        updatedAt: '2024-06-15T00:00:00Z',
        organizationId: null,
        userId: null,
        summary: 'Affirmed the conviction for murder; circumstantial evidence sufficed.',
        facts: 'The accused was charged with murder...',
        petitionerArguments: null,
        respondentArguments: null,
        issues: 'Whether the prosecution proved guilt beyond reasonable doubt.',
        ruling: 'The Court affirmed the conviction.',
        doctrine: 'Circumstantial evidence sufficient when...',
        dispositive: 'WHEREFORE, the appeal is DISMISSED.',
      },
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });

    expect(getByText('People v. Reyes — Criminal Case Digest')).toBeTruthy();
    // Eyebrow uses the digest-type label map
    expect(getByText('Case digest')).toBeTruthy();
    // TL;DR shows the summary
    expect(getByText('Affirmed the conviction for murder; circumstantial evidence sufficed.')).toBeTruthy();
    // Each section heading + body
    expect(getByText('Facts')).toBeTruthy();
    expect(getByText('Issues')).toBeTruthy();
    expect(getByText('Ruling')).toBeTruthy();
    expect(getByText('Doctrine')).toBeTruthy();
    expect(getByText('Dispositive')).toBeTruthy();
    expect(getByText('WHEREFORE, the appeal is DISMISSED.')).toBeTruthy();
  });

  it('omits sections that have no content', () => {
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
        updatedAt: '2024-01-01T00:00:00Z',
        organizationId: null,
        userId: null,
        summary: null,
        facts: 'Only facts here',
        petitionerArguments: null,
        respondentArguments: null,
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    expect(queryByText('Facts')).toBeTruthy();
    expect(queryByText('Only facts here')).toBeTruthy();
    expect(queryByText('Issues')).toBeNull();
    expect(queryByText('Ruling')).toBeNull();
    expect(queryByText('Doctrine')).toBeNull();
    expect(queryByText('Dispositive')).toBeNull();
  });

  it('routes the sticky CTA to the source reader when legalDocumentId is set', () => {
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
        updatedAt: '2024-01-01T00:00:00Z',
        organizationId: null,
        userId: null,
        summary: null,
        facts: 'Some facts',
        petitionerArguments: null,
        respondentArguments: null,
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    // StickyCTA renders the default `timeLeft` meta "4 min left" — press it to
    // trigger the parent Pressable's onPress (testing-library bubbles).
    fireEvent.press(getByText('4 min left'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc-789');
  });

  it('alerts when the sticky CTA is pressed without a source document', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockUseDigest.mockReturnValue({
      data: {
        id: 'digest-123',
        title: 'Orphan Digest',
        digestType: 'case_digest',
        reviewStatus: 'draft',
        visibility: 'private',
        confidenceScore: null,
        sourceOrigin: 'user_scan',
        legalDocumentId: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        organizationId: null,
        userId: null,
        summary: null,
        facts: 'Facts',
        petitionerArguments: null,
        respondentArguments: null,
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
      },
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<DigestDetailRoute />, { wrapper: createWrapper() });
    fireEvent.press(getByText('4 min left'));
    expect(alertSpy).toHaveBeenCalledWith('No source', expect.any(String));
  });
});
