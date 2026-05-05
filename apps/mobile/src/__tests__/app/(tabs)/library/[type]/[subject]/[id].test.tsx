import React from 'react';
import { render } from '@testing-library/react-native';

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

import { useLocalSearchParams } from 'expo-router';

const mockUseDerivative = jest.fn();
jest.mock('@/features/derivatives/hooks/use-derivatives', () => ({
  useDerivative: (...args: unknown[]) => mockUseDerivative(...args),
}));

import LibraryDetailScreen from '@/app/(tabs)/library/[type]/[subject]/[id]';

const baseDetail = {
  id: 'art-1',
  title: 'Sample Digest',
  derivativeType: 'case_digest' as const,
  confidenceScore: 0.9,
  createdAt: '2026-04-20T10:00:00Z',
  publishedAt: null,
  audience: 'both',
  language: 'en',
  sourceDocument: {
    id: 'doc-1',
    title: null,
    shortTitle: null,
    citationText: 'G.R. No. 999',
    court: 'SC',
    decisionDate: null,
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
  contentJson: {
    summary: 'Short summary.',
    facts: 'Some facts.',
    ruling: 'The ruling.',
  },
  contentPlainText: null,
  disclaimerBody: null,
  mcqQuestion: null,
  essayPrompt: null,
};

describe('LibraryDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'art-1',
      type: 'digests',
      subject: 'criminal-law',
    });
  });

  it('dispatches to the digest renderer based on derivativeType', () => {
    mockUseDerivative.mockReturnValue({
      data: baseDetail,
      isLoading: false,
      error: null,
    });

    const { queryByText } = render(<LibraryDetailScreen />);
    expect(queryByText('Sample Digest')).toBeTruthy();
    // Digest renderer headings appear
    expect(queryByText('Summary')).toBeTruthy();
    expect(queryByText('Facts')).toBeTruthy();
    expect(queryByText('Ruling')).toBeTruthy();
    // Breadcrumb shows type + subject names
    expect(queryByText(/Case Digests — Criminal Law/)).toBeTruthy();
  });

  it('shows an error fallback when useDerivative errors', () => {
    mockUseDerivative.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Boom'),
    });

    const { queryByText } = render(<LibraryDetailScreen />);
    expect(queryByText('Boom')).toBeTruthy();
  });
});
