import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { router, useLocalSearchParams } from 'expo-router';

const mockUseDerivatives = jest.fn();
jest.mock('@/features/derivatives/hooks/use-derivatives', () => ({
  useDerivatives: (...args: unknown[]) => mockUseDerivatives(...args),
}));

import LibrarySubjectScreen from '@/app/(tabs)/library/[type]/[subject]/index';

const item = {
  id: 'art-1',
  title: 'People v. Dela Cruz Digest',
  derivativeType: 'case_digest',
  confidenceScore: 0.82,
  createdAt: '2026-04-20T10:00:00Z',
  publishedAt: null,
  audience: 'both',
  language: 'en',
  sourceDocument: {
    id: 'doc-1',
    title: 'People v. Dela Cruz',
    shortTitle: null,
    citationText: 'G.R. No. 123456',
    court: 'SC',
    decisionDate: '2020-01-01',
  },
  subjects: [
    {
      code: 'criminal_law',
      name: 'Criminal Law',
      taxonomyVersion: 'study_8',
      isPrimary: true,
    },
  ],
  disclaimer: null,
  isGated: false,
  upgradeTier: null,
};

describe('LibrarySubjectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      type: 'digests',
      subject: 'criminal-law',
    });
  });

  it('renders artifact cards from the paged response', () => {
    mockUseDerivatives.mockReturnValue({
      data: { pages: [{ data: [item], meta: { hasNext: false, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { queryByText } = render(<LibrarySubjectScreen />);
    expect(queryByText('Criminal Law')).toBeTruthy();
    expect(queryByText('People v. Dela Cruz Digest')).toBeTruthy();
    expect(queryByText('G.R. No. 123456')).toBeTruthy();
    expect(queryByText('82%')).toBeTruthy();
  });

  it('navigates to the detail route with nested slugs when a card is pressed', () => {
    mockUseDerivatives.mockReturnValue({
      data: { pages: [{ data: [item], meta: { hasNext: false, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { getByLabelText } = render(<LibrarySubjectScreen />);
    fireEvent.press(getByLabelText('People v. Dela Cruz Digest'));
    expect(router.push).toHaveBeenCalledWith(
      '/library/digests/criminal-law/art-1',
    );
  });

  it('renders empty state when no items are returned', () => {
    mockUseDerivatives.mockReturnValue({
      data: { pages: [{ data: [], meta: { hasNext: false, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { queryByText } = render(<LibrarySubjectScreen />);
    expect(queryByText('No content yet')).toBeTruthy();
  });
});
