import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { FlashcardRenderer } from './flashcard-renderer';
import { FLASHCARD_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('FlashcardRenderer', () => {
  it('renders each card showing the front by default', () => {
    const { queryByText } = render(
      <FlashcardRenderer data={makeDetail('flashcard', FLASHCARD_CONTENT)} />,
    );
    expect(queryByText('What is the exclusionary rule?')).toBeTruthy();
    expect(queryByText('Fruit of the poisonous tree?')).toBeTruthy();
  });

  it('flips a card to show the back when Flip is tapped', () => {
    const { queryAllByLabelText, queryByText } = render(
      <FlashcardRenderer data={makeDetail('flashcard', FLASHCARD_CONTENT)} />,
    );
    const flipButtons = queryAllByLabelText('Flip card');
    expect(flipButtons.length).toBeGreaterThan(0);
    fireEvent.press(flipButtons[0]!);
    expect(queryByText('Illegally obtained evidence is inadmissible.')).toBeTruthy();
  });

  it('falls back to single front/back when cards array is absent', () => {
    const { queryByText } = render(
      <FlashcardRenderer
        data={makeDetail('flashcard', { front: 'Q?', back: 'A.' })}
      />,
    );
    expect(queryByText('Q?')).toBeTruthy();
  });

  it('renders unavailable when no cards present', () => {
    const { queryByText } = render(
      <FlashcardRenderer data={makeDetail('flashcard', {})} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});
