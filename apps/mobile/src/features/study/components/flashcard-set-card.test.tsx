import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { FlashcardSetCard } from './flashcard-set-card';
import type { FlashcardSet } from '../types';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

const mockSet: FlashcardSet = {
  id: 'set-1',
  organizationId: 'org-1',
  userId: 'user-1',
  title: 'Criminal Law Fundamentals',
  description: 'Key concepts from the Revised Penal Code',
  barSubject: 'criminal_law',
  topic: 'elements of crimes',
  visibility: 'private',
  cardCount: 25,
  createdAt: '2026-03-22T10:00:00Z',
  updatedAt: '2026-03-22T10:00:00Z',
};

describe('FlashcardSetCard', () => {
  const defaultProps = {
    item: mockSet,
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title', () => {
    const { getByText } = render(<FlashcardSetCard {...defaultProps} />);
    expect(getByText('Criminal Law Fundamentals')).toBeTruthy();
  });

  it('renders description', () => {
    const { getByText } = render(<FlashcardSetCard {...defaultProps} />);
    expect(getByText('Key concepts from the Revised Penal Code')).toBeTruthy();
  });

  it('shows bar subject badge', () => {
    const { getByText } = render(<FlashcardSetCard {...defaultProps} />);
    expect(getByText('criminal law')).toBeTruthy();
  });

  it('hides bar subject badge when null', () => {
    const item = { ...mockSet, barSubject: null };
    const { queryByText } = render(
      <FlashcardSetCard {...defaultProps} item={item} />,
    );
    expect(queryByText('criminal law')).toBeNull();
  });

  it('shows card count', () => {
    const { getByText } = render(<FlashcardSetCard {...defaultProps} />);
    expect(getByText('25 cards')).toBeTruthy();
  });

  it('shows singular card text for 1', () => {
    const item = { ...mockSet, cardCount: 1 };
    const { getByText } = render(
      <FlashcardSetCard {...defaultProps} item={item} />,
    );
    expect(getByText('1 card')).toBeTruthy();
  });

  it('shows creation date', () => {
    const { getByText } = render(<FlashcardSetCard {...defaultProps} />);
    expect(getByText('Mar 22, 2026')).toBeTruthy();
  });

  it('calls onPress when card tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <FlashcardSetCard {...defaultProps} onPress={onPress} />,
    );

    fireEvent.press(getByText('Criminal Law Fundamentals'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows delete button when onDelete provided', () => {
    const { getByTestId } = render(
      <FlashcardSetCard {...defaultProps} onDelete={jest.fn()} />,
    );
    expect(getByTestId('icon-trash-outline')).toBeTruthy();
  });

  it('calls onDelete when trash pressed', () => {
    const onDelete = jest.fn();
    const { getByTestId } = render(
      <FlashcardSetCard {...defaultProps} onDelete={onDelete} />,
    );

    fireEvent.press(getByTestId('icon-trash-outline'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides delete button when onDelete not provided', () => {
    const { queryByTestId } = render(
      <FlashcardSetCard {...defaultProps} />,
    );
    expect(queryByTestId('icon-trash-outline')).toBeNull();
  });

  it('hides description when null', () => {
    const item = { ...mockSet, description: null };
    const { queryByText } = render(
      <FlashcardSetCard {...defaultProps} item={item} />,
    );
    expect(queryByText('Key concepts from the Revised Penal Code')).toBeNull();
  });
});
