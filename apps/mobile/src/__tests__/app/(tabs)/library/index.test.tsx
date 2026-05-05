import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import LibraryHubScreen from '@/app/(tabs)/library/index';

describe('LibraryHubScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders a tile for each of the 11 derivative types', () => {
    const { queryByText } = render(<LibraryHubScreen />);
    expect(queryByText('Case Digests')).toBeTruthy();
    expect(queryByText('Doctrine Extracts')).toBeTruthy();
    expect(queryByText('MCQs')).toBeTruthy();
    expect(queryByText('Essay Prompts')).toBeTruthy();
    expect(queryByText('Subject Outlines')).toBeTruthy();
    expect(queryByText('Flashcards')).toBeTruthy();
    expect(queryByText('Essay Model Answers')).toBeTruthy();
    expect(queryByText('Suggested Bar Answers')).toBeTruthy();
    expect(queryByText('Sample Pleadings')).toBeTruthy();
    expect(queryByText('Sample Contracts')).toBeTruthy();
    expect(queryByText('One-Page Summaries')).toBeTruthy();
  });

  it('routes to /library/<slug> when a tile is pressed', () => {
    const { getByLabelText } = render(<LibraryHubScreen />);
    fireEvent.press(getByLabelText('Browse Case Digests'));
    expect(router.push).toHaveBeenCalledWith('/library/digests');
  });
});
