import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { FlashcardPlayer } from './flashcard-player';
import type { Flashcard } from '../types';

const mockCard: Flashcard = {
  id: 'card-1',
  flashcardSetId: 'set-1',
  front: 'What is the doctrine of res judicata?',
  back: 'A final judgment on the merits bars relitigation of the same cause of action.',
  sourceType: 'ai_generated',
  ordering: 1,
  createdAt: '2026-03-22T10:00:00Z',
  legalDocument: {
    id: 'doc-1',
    title: 'G.R. No. 12345 - Smith v. Jones',
    documentType: 'case',
  },
};

describe('FlashcardPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders front side with QUESTION label', () => {
    const { getByText } = render(
      <FlashcardPlayer card={mockCard} isFlipped={false} onFlip={jest.fn()} />,
    );

    expect(getByText('QUESTION')).toBeTruthy();
    expect(getByText('What is the doctrine of res judicata?')).toBeTruthy();
  });

  it('shows "Tap to flip" hint on front', () => {
    const { getByText } = render(
      <FlashcardPlayer card={mockCard} isFlipped={false} onFlip={jest.fn()} />,
    );

    expect(getByText('Tap to flip')).toBeTruthy();
  });

  it('renders back side with ANSWER label', () => {
    const { getByText } = render(
      <FlashcardPlayer card={mockCard} isFlipped={true} onFlip={jest.fn()} />,
    );

    expect(getByText('ANSWER')).toBeTruthy();
    expect(getByText('A final judgment on the merits bars relitigation of the same cause of action.')).toBeTruthy();
  });

  it('shows source reference on back when legalDocument exists', () => {
    const { getByText } = render(
      <FlashcardPlayer card={mockCard} isFlipped={true} onFlip={jest.fn()} />,
    );

    expect(getByText('Source: G.R. No. 12345 - Smith v. Jones')).toBeTruthy();
  });

  it('hides source reference when no legalDocument', () => {
    const cardNoDoc = { ...mockCard, legalDocument: null };
    const { queryByText } = render(
      <FlashcardPlayer card={cardNoDoc} isFlipped={true} onFlip={jest.fn()} />,
    );

    expect(queryByText(/Source:/)).toBeNull();
  });

  it('calls onFlip when tapped', () => {
    const onFlip = jest.fn();
    const { getByText } = render(
      <FlashcardPlayer card={mockCard} isFlipped={false} onFlip={onFlip} />,
    );

    fireEvent.press(getByText('What is the doctrine of res judicata?'));
    expect(onFlip).toHaveBeenCalledTimes(1);
  });
});
