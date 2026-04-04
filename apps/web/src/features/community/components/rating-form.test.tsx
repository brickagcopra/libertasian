import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockMyRating: unknown = null;
const mockUpsertMutate = vi.fn();
const mockDeleteMutate = vi.fn();

vi.mock('../hooks/use-community-ratings', () => ({
  useMyRating: () => ({
    data: { data: mockMyRating },
  }),
  useUpsertRating: () => ({
    mutate: mockUpsertMutate,
    isPending: false,
  }),
  useDeleteRating: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
}));

vi.mock('./star-rating', () => ({
  StarRatingInput: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (v: number) => void;
  }) => (
    <div data-testid="star-input">
      <span>Stars: {value}</span>
      <button onClick={() => onChange(4)}>Set 4</button>
    </div>
  ),
}));

import { RatingForm } from './rating-form';

describe('RatingForm', () => {
  const defaultProps = {
    entityType: 'digest' as const,
    entityId: 'd1',
  };

  beforeEach(() => {
    mockMyRating = null;
    mockUpsertMutate.mockReset();
    mockDeleteMutate.mockReset();
  });

  it('renders rate form when no existing rating', () => {
    render(<RatingForm {...defaultProps} />);
    expect(screen.getByText('Rate this content')).toBeInTheDocument();
  });

  it('renders score, title, and review inputs', () => {
    render(<RatingForm {...defaultProps} />);
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Brief summary...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Share your thoughts...')).toBeInTheDocument();
  });

  it('renders Submit Rating button', () => {
    render(<RatingForm {...defaultProps} />);
    expect(screen.getByText('Submit Rating')).toBeInTheDocument();
  });

  it('disables submit when score is 0', () => {
    render(<RatingForm {...defaultProps} />);
    const submitBtn = screen.getByText('Submit Rating');
    expect(submitBtn).toBeDisabled();
  });

  it('shows existing rating in compact view', () => {
    mockMyRating = {
      id: 'r1',
      score: 5,
      reviewTitle: 'Great!',
      reviewBody: 'Very useful content.',
    };
    render(<RatingForm {...defaultProps} />);
    expect(screen.getByText('Your rating')).toBeInTheDocument();
    expect(screen.getByText('Great!')).toBeInTheDocument();
    expect(screen.getByText('Very useful content.')).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons for existing rating', () => {
    mockMyRating = {
      id: 'r1',
      score: 4,
      reviewTitle: null,
      reviewBody: null,
    };
    render(<RatingForm {...defaultProps} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows edit form when Edit is clicked', () => {
    mockMyRating = {
      id: 'r1',
      score: 4,
      reviewTitle: 'Good',
      reviewBody: 'Nice.',
    };
    render(<RatingForm {...defaultProps} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Edit your rating')).toBeInTheDocument();
    expect(screen.getByText('Update Rating')).toBeInTheDocument();
  });
});
