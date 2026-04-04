import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { ReactNode } from 'react';

// Mock vote hooks used by VoteButtons (rendered inside card for digests)
vi.mock('../hooks/use-community-votes', () => ({
  useMyVote: () => ({ data: { success: true, data: null }, isLoading: false }),
  useUpsertVote: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveVote: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MarketplaceItemCard } from './marketplace-item-card';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const baseItem = {
  id: 'item-1',
  title: 'Constitutional Law Flashcards',
  contentType: 'flashcard_set' as const,
  creator: {
    id: 'u1',
    fullName: 'Juan Dela Cruz',
    expertVerification: null,
  },
  avgRating: 4.5,
  ratingCount: 12,
  itemCount: 30,
  voteScore: 0,
  barSubject: 'Constitutional Law',
  topic: 'Bill of Rights',
  description: 'Comprehensive flashcard set covering the Bill of Rights',
  createdAt: '2026-01-01T00:00:00Z',
};

const renderCard = (item = baseItem, showContentType = false) => {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <MarketplaceItemCard item={item} showContentType={showContentType} />
    </Wrapper>,
  );
};

describe('MarketplaceItemCard', () => {
  it('renders item title as a link', () => {
    renderCard();
    const link = screen.getByText('Constitutional Law Flashcards');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')?.getAttribute('href')).toBe('/study/flashcards/item-1');
  });

  it('renders creator name', () => {
    renderCard();
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
  });

  it('renders bar subject badge when provided', () => {
    renderCard();
    expect(screen.getByText('Constitutional Law')).toBeInTheDocument();
  });

  it('renders topic when provided', () => {
    renderCard();
    expect(screen.getByText('Bill of Rights')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    renderCard();
    expect(
      screen.getByText('Comprehensive flashcard set covering the Bill of Rights'),
    ).toBeInTheDocument();
  });

  it('renders item count', () => {
    renderCard();
    expect(screen.getByText('30 items')).toBeInTheDocument();
  });

  it('formats large item counts with "k" suffix', () => {
    renderCard({ ...baseItem, itemCount: 1500 });
    expect(screen.getByText('1.5k items')).toBeInTheDocument();
  });

  it('renders rating display', () => {
    renderCard();
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('(12)')).toBeInTheDocument();
  });

  it('shows content type badge when showContentType is true', () => {
    renderCard(baseItem, true);
    expect(screen.getByText('Flashcard Set')).toBeInTheDocument();
  });

  it('does not show content type badge when showContentType is false', () => {
    renderCard(baseItem, false);
    expect(screen.queryByText('Flashcard Set')).not.toBeInTheDocument();
  });

  it('links to correct route for reviewer_pack', () => {
    renderCard({
      ...baseItem,
      id: 'rp-1',
      contentType: 'reviewer_pack',
      title: 'Review Pack',
    });

    const link = screen.getByText('Review Pack');
    expect(link.closest('a')?.getAttribute('href')).toBe('/study/reviewer-packs/rp-1');
  });

  it('links to correct route for digest', () => {
    renderCard({
      ...baseItem,
      id: 'd-1',
      contentType: 'digest',
      title: 'Case Digest',
    });

    const link = screen.getByText('Case Digest');
    expect(link.closest('a')?.getAttribute('href')).toBe('/digests/d-1');
  });

  it('renders vote buttons for digest content type', () => {
    renderCard({
      ...baseItem,
      contentType: 'digest',
      voteScore: 5,
    });

    // VoteButtons are rendered, vote score should be visible
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not render vote buttons for flashcard_set content type', () => {
    const { container } = renderCard({
      ...baseItem,
      contentType: 'flashcard_set',
      voteScore: 5,
    });

    // VoteButtons should not be rendered (no thumbs icons)
    // The score "5" should not appear as a vote score span
    const scoreSpans = container.querySelectorAll('span.min-w-\\[2ch\\]');
    expect(scoreSpans).toHaveLength(0);
  });

  it('renders expert badge when creator has approved verification', () => {
    renderCard({
      ...baseItem,
      creator: {
        id: 'u1',
        fullName: 'Atty. Santos',
        expertVerification: {
          expertiseType: 'lawyer' as const,
          status: 'approved' as const,
        },
      },
    });

    expect(screen.getByText('Lawyer')).toBeInTheDocument();
  });

  it('does not render expert badge when creator has no verification', () => {
    renderCard();
    expect(screen.queryByText('Lawyer')).not.toBeInTheDocument();
  });

  it('renders contributor profile link', () => {
    renderCard();
    const creatorLink = screen.getByText('Juan Dela Cruz').closest('a');
    expect(creatorLink?.getAttribute('href')).toBe('/community/contributors/u1');
  });

  it('hides bar subject badge when not provided', () => {
    renderCard({ ...baseItem, barSubject: null });
    expect(screen.queryByText('Constitutional Law')).not.toBeInTheDocument();
  });

  it('hides description when not provided', () => {
    renderCard({ ...baseItem, description: null });
    expect(
      screen.queryByText('Comprehensive flashcard set covering the Bill of Rights'),
    ).not.toBeInTheDocument();
  });
});
