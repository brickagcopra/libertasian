import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockData: unknown = null;
let mockIsLoading = false;
let mockError: Error | null = null;

vi.mock('../hooks/use-marketplace', () => ({
  useMarketplaceFeatured: () => ({
    data: mockData,
    isLoading: mockIsLoading,
    error: mockError,
  }),
}));

vi.mock('./expert-badge', () => ({
  ExpertBadge: ({ expertiseType }: { expertiseType: string }) => (
    <span data-testid="expert-badge">{expertiseType}</span>
  ),
}));

vi.mock('./star-rating', () => ({
  StarRatingDisplay: ({ value }: { value: number }) => (
    <span data-testid="star-rating">{value}</span>
  ),
}));

import { FeaturedSection } from './featured-section';

describe('FeaturedSection', () => {
  beforeEach(() => {
    mockData = null;
    mockIsLoading = false;
    mockError = null;
  });

  it('shows loading skeleton when loading', () => {
    mockIsLoading = true;
    const { container } = render(<FeaturedSection />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows error alert on error', () => {
    mockError = new Error('Network error');
    render(<FeaturedSection />);
    expect(screen.getByText('Failed to load featured content.')).toBeInTheDocument();
  });

  it('renders nothing when data is null', () => {
    mockData = { data: null };
    const { container } = render(<FeaturedSection />);
    expect(container.innerHTML).toBe('');
  });

  it('renders featured sections with items', () => {
    mockData = {
      data: {
        flashcardSets: [
          {
            id: 'f1',
            title: 'Constitutional Law Set',
            avgRating: 4.5,
            ratingCount: 10,
            creator: { fullName: 'Juan', expertVerification: null },
          },
        ],
        reviewerPacks: [
          {
            id: 'r1',
            title: 'Bar Reviewer 2026',
            avgRating: 4.0,
            ratingCount: 5,
            creator: {
              fullName: 'Maria',
              expertVerification: {
                expertiseType: 'lawyer',
                status: 'verified',
              },
            },
          },
        ],
        digests: [],
      },
    };
    render(<FeaturedSection />);
    expect(screen.getByText('Top Flashcard Sets')).toBeInTheDocument();
    expect(screen.getByText('Constitutional Law Set')).toBeInTheDocument();
    expect(screen.getByText('Top Reviewer Packs')).toBeInTheDocument();
    expect(screen.getByText('Bar Reviewer 2026')).toBeInTheDocument();
  });

  it('renders Browse all links', () => {
    mockData = {
      data: {
        flashcardSets: [
          {
            id: 'f1',
            title: 'Set 1',
            avgRating: 3,
            ratingCount: 1,
            creator: { fullName: 'A', expertVerification: null },
          },
        ],
        reviewerPacks: [],
        digests: [],
      },
    };
    render(<FeaturedSection />);
    expect(screen.getByText('Browse all')).toBeInTheDocument();
  });

  it('skips sections with empty items', () => {
    mockData = {
      data: {
        flashcardSets: [],
        reviewerPacks: [],
        digests: [
          {
            id: 'd1',
            title: 'Featured Digest',
            avgRating: 5,
            ratingCount: 20,
            creator: { fullName: 'Expert', expertVerification: null },
          },
        ],
      },
    };
    render(<FeaturedSection />);
    expect(screen.queryByText('Top Flashcard Sets')).not.toBeInTheDocument();
    expect(screen.queryByText('Top Reviewer Packs')).not.toBeInTheDocument();
    expect(screen.getByText('Top Digests')).toBeInTheDocument();
    expect(screen.getByText('Featured Digest')).toBeInTheDocument();
  });

  it('renders expert badge for verified creators', () => {
    mockData = {
      data: {
        flashcardSets: [
          {
            id: 'f1',
            title: 'Expert Set',
            avgRating: 5,
            ratingCount: 10,
            creator: {
              fullName: 'Expert User',
              expertVerification: { expertiseType: 'professor', status: 'verified' },
            },
          },
        ],
        reviewerPacks: [],
        digests: [],
      },
    };
    render(<FeaturedSection />);
    expect(screen.getByTestId('expert-badge')).toBeInTheDocument();
  });
});
