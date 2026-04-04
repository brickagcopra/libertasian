import React from 'react';
import { render } from '@testing-library/react-native';

import { StarRatingDisplay, StarRatingInput } from './star-rating';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, size, color }: { name: string; size: number; color: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

describe('StarRatingDisplay', () => {
  it('renders 5 star icons', () => {
    const { getAllByTestId } = render(
      <StarRatingDisplay value={3} />,
    );

    const filledStars = getAllByTestId('icon-star');
    const outlineStars = getAllByTestId('icon-star-outline');
    expect(filledStars.length + outlineStars.length).toBe(5);
  });

  it('fills correct number of stars based on value', () => {
    const { getAllByTestId } = render(
      <StarRatingDisplay value={4} />,
    );

    expect(getAllByTestId('icon-star').length).toBe(4);
    expect(getAllByTestId('icon-star-outline').length).toBe(1);
  });

  it('shows numeric value when provided', () => {
    const { getByText } = render(
      <StarRatingDisplay value={4.5} count={10} />,
    );

    expect(getByText('4.5')).toBeTruthy();
    expect(getByText('(10)')).toBeTruthy();
  });

  it('hides numeric value when value is null', () => {
    const { queryByText } = render(
      <StarRatingDisplay value={null} />,
    );

    expect(queryByText('0.0')).toBeNull();
  });

  it('hides count when not provided', () => {
    const { getByText, queryByText } = render(
      <StarRatingDisplay value={3.0} />,
    );

    expect(getByText('3.0')).toBeTruthy();
    expect(queryByText(/^\(\d+\)$/)).toBeNull();
  });

  it('shows all outline stars for value 0', () => {
    const { getAllByTestId, queryAllByTestId } = render(
      <StarRatingDisplay value={0} />,
    );

    expect(getAllByTestId('icon-star-outline').length).toBe(5);
    expect(queryAllByTestId('icon-star').length).toBe(0);
  });

  it('shows all filled stars for value 5', () => {
    const { getAllByTestId, queryAllByTestId } = render(
      <StarRatingDisplay value={5} />,
    );

    expect(getAllByTestId('icon-star').length).toBe(5);
    expect(queryAllByTestId('icon-star-outline').length).toBe(0);
  });

  it('rounds to nearest star for value 3.7 (4 filled)', () => {
    const { getAllByTestId } = render(
      <StarRatingDisplay value={3.7} />,
    );

    expect(getAllByTestId('icon-star').length).toBe(4);
    expect(getAllByTestId('icon-star-outline').length).toBe(1);
  });

  it('rounds to nearest star for value 3.2 (3 filled)', () => {
    const { getAllByTestId } = render(
      <StarRatingDisplay value={3.2} />,
    );

    expect(getAllByTestId('icon-star').length).toBe(3);
    expect(getAllByTestId('icon-star-outline').length).toBe(2);
  });

  it('renders with md size', () => {
    const { getByText } = render(
      <StarRatingDisplay value={4.0} count={5} size="md" />,
    );

    expect(getByText('4.0')).toBeTruthy();
    expect(getByText('(5)')).toBeTruthy();
  });
});

describe('StarRatingInput', () => {
  it('renders 5 star icons', () => {
    const { getAllByTestId } = render(
      <StarRatingInput value={0} onChange={jest.fn()} />,
    );

    const stars = getAllByTestId('icon-star-outline');
    expect(stars.length).toBe(5);
  });

  it('fills stars up to current value', () => {
    const { getAllByTestId } = render(
      <StarRatingInput value={3} onChange={jest.fn()} />,
    );

    expect(getAllByTestId('icon-star').length).toBe(3);
    expect(getAllByTestId('icon-star-outline').length).toBe(2);
  });

  it('renders with sm size', () => {
    const tree = render(
      <StarRatingInput value={2} onChange={jest.fn()} size="sm" />,
    ).toJSON();

    expect(tree).toBeTruthy();
  });

  it('renders with md size by default', () => {
    const tree = render(
      <StarRatingInput value={2} onChange={jest.fn()} />,
    ).toJSON();

    expect(tree).toBeTruthy();
  });
});
