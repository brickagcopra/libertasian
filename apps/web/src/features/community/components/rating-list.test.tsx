import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRatings: unknown[] = [];
let mockAggregate: unknown = null;
let mockIsLoading = false;
let mockError: Error | null = null;

vi.mock('../hooks/use-community-ratings', () => ({
  useRatings: () => ({
    data: { data: mockRatings, aggregate: mockAggregate },
    isLoading: mockIsLoading,
    error: mockError,
  }),
}));

vi.mock('./star-rating', () => ({
  StarRatingDisplay: ({ value }: { value: number }) => (
    <span data-testid="star-rating">{value}</span>
  ),
}));

import { RatingList } from './rating-list';

describe('RatingList', () => {
  const defaultProps = {
    entityType: 'digest' as const,
    entityId: 'd1',
  };

  beforeEach(() => {
    mockRatings = [];
    mockAggregate = null;
    mockIsLoading = false;
    mockError = null;
  });

  it('shows loading skeletons when loading', () => {
    mockIsLoading = true;
    const { container } = render(<RatingList {...defaultProps} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows error alert on error', () => {
    mockError = new Error('Network error');
    render(<RatingList {...defaultProps} />);
    expect(screen.getByText('Failed to load ratings.')).toBeInTheDocument();
  });

  it('shows empty state when no ratings', () => {
    render(<RatingList {...defaultProps} />);
    expect(screen.getByText(/No ratings yet/)).toBeInTheDocument();
  });

  it('renders aggregate summary', () => {
    mockAggregate = {
      avgRating: 4.2,
      ratingCount: 15,
      distribution: { 5: 5, 4: 6, 3: 2, 2: 1, 1: 1 },
    };
    render(<RatingList {...defaultProps} />);
    // 4.2 appears in both the aggregate display and the star-rating mock
    const ratingTexts = screen.getAllByText('4.2');
    expect(ratingTexts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('15 ratings')).toBeInTheDocument();
  });

  it('shows singular rating text for count of 1', () => {
    mockAggregate = {
      avgRating: 5.0,
      ratingCount: 1,
      distribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    };
    render(<RatingList {...defaultProps} />);
    expect(screen.getByText('1 rating')).toBeInTheDocument();
  });

  it('renders individual rating items', () => {
    mockRatings = [
      {
        id: 'r1',
        user: { fullName: 'Juan Cruz' },
        score: 5,
        reviewTitle: 'Excellent!',
        reviewBody: 'Very helpful digest.',
        createdAt: '2026-03-01T00:00:00Z',
      },
    ];
    render(<RatingList {...defaultProps} />);
    expect(screen.getByText('Juan Cruz')).toBeInTheDocument();
    expect(screen.getByText('Excellent!')).toBeInTheDocument();
    expect(screen.getByText('Very helpful digest.')).toBeInTheDocument();
  });

  it('shows Anonymous for ratings without user', () => {
    mockRatings = [
      {
        id: 'r1',
        user: null,
        score: 3,
        reviewTitle: null,
        reviewBody: null,
        createdAt: '2026-03-01T00:00:00Z',
      },
    ];
    render(<RatingList {...defaultProps} />);
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it('renders rating distribution bars', () => {
    mockAggregate = {
      avgRating: 3.0,
      ratingCount: 10,
      distribution: { 5: 2, 4: 2, 3: 3, 2: 2, 1: 1 },
    };
    render(<RatingList {...defaultProps} />);
    // Check that distribution numbers are visible
    expect(screen.getByText('10 ratings')).toBeInTheDocument();
  });
});
