import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { ReviewerPackCard } from './reviewer-pack-card';
import type { ReviewerPack } from '../types';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

const mockPack: ReviewerPack = {
  id: 'pack-1',
  organizationId: 'org-1',
  creatorUserId: 'user-1',
  title: 'Political Law Review Pack',
  description: 'Essential cases and codals for bar review',
  barSubject: 'political_law',
  topic: 'constitutional law',
  visibility: 'private',
  itemCount: 12,
  createdAt: '2026-03-22T10:00:00Z',
  updatedAt: '2026-03-22T10:00:00Z',
  creator: {
    id: 'user-1',
    fullName: 'Atty. Maria Santos',
  },
};

describe('ReviewerPackCard', () => {
  const defaultProps = {
    item: mockPack,
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('Political Law Review Pack')).toBeTruthy();
  });

  it('renders description', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('Essential cases and codals for bar review')).toBeTruthy();
  });

  it('shows bar subject badge', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('political law')).toBeTruthy();
  });

  it('hides bar subject when null', () => {
    const item = { ...mockPack, barSubject: null };
    const { queryByText } = render(
      <ReviewerPackCard {...defaultProps} item={item} />,
    );
    expect(queryByText('political law')).toBeNull();
  });

  it('shows item count', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('12 items')).toBeTruthy();
  });

  it('shows singular for 1 item', () => {
    const item = { ...mockPack, itemCount: 1 };
    const { getByText } = render(
      <ReviewerPackCard {...defaultProps} item={item} />,
    );
    expect(getByText('1 item')).toBeTruthy();
  });

  it('shows creator name', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('by Atty. Maria Santos')).toBeTruthy();
  });

  it('hides creator when null', () => {
    const item = { ...mockPack, creator: undefined };
    const { queryByText } = render(
      <ReviewerPackCard {...defaultProps} item={item} />,
    );
    expect(queryByText(/by /)).toBeNull();
  });

  it('shows creation date', () => {
    const { getByText } = render(<ReviewerPackCard {...defaultProps} />);
    expect(getByText('Mar 22, 2026')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <ReviewerPackCard {...defaultProps} onPress={onPress} />,
    );
    fireEvent.press(getByText('Political Law Review Pack'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows delete button when onDelete provided', () => {
    const { getByTestId } = render(
      <ReviewerPackCard {...defaultProps} onDelete={jest.fn()} />,
    );
    expect(getByTestId('icon-trash-outline')).toBeTruthy();
  });

  it('calls onDelete when pressed', () => {
    const onDelete = jest.fn();
    const { getByTestId } = render(
      <ReviewerPackCard {...defaultProps} onDelete={onDelete} />,
    );
    fireEvent.press(getByTestId('icon-trash-outline'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides delete button when not provided', () => {
    const { queryByTestId } = render(<ReviewerPackCard {...defaultProps} />);
    expect(queryByTestId('icon-trash-outline')).toBeNull();
  });

  it('hides description when null', () => {
    const item = { ...mockPack, description: null };
    const { queryByText } = render(
      <ReviewerPackCard {...defaultProps} item={item} />,
    );
    expect(queryByText('Essential cases and codals for bar review')).toBeNull();
  });
});
