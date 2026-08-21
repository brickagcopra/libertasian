import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { MarketplaceItemCard } from './marketplace-item-card';
import type { MarketplaceItem } from '../types';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue({ success: true, data: null }),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock VoteButtons to avoid nested hook complexity
jest.mock('./vote-buttons', () => {
  const { Text } = require('react-native');
  return {
    VoteButtons: ({ voteScore }: { voteScore?: number }) =>
      require('react').createElement(
        Text,
        { testID: 'vote-buttons' },
        voteScore != null ? String(voteScore) : '',
      ),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const baseItem: MarketplaceItem = {
  id: 'item-1',
  contentType: 'flashcard_set',
  title: 'Criminal Law Reviewer',
  description: 'A comprehensive flashcard set for criminal law.',
  barSubject: 'criminal_law',
  topic: 'Elements of crimes',
  avgRating: 4.5,
  ratingCount: 12,
  itemCount: 25,
  creator: {
    id: 'user-1',
    fullName: 'Juan dela Cruz',
    expertVerification: null,
  },
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MarketplaceItemCard', () => {
  it('renders title', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Criminal Law Reviewer')).toBeTruthy();
  });

  it('renders description', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('A comprehensive flashcard set for criminal law.')).toBeTruthy();
  });

  it('hides description when null', () => {
    const item = { ...baseItem, description: null };

    const { queryByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    expect(queryByText('A comprehensive flashcard set for criminal law.')).toBeNull();
  });

  it('renders creator name', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Juan dela Cruz')).toBeTruthy();
  });

  it('renders bar subject badge', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('criminal law')).toBeTruthy();
  });

  it('renders topic text', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Elements of crimes')).toBeTruthy();
  });

  it('renders rating display', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('4.5')).toBeTruthy();
    expect(getByText('(12)')).toBeTruthy();
  });

  it('renders item count', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('25 items')).toBeTruthy();
  });

  it('formats large item counts with k suffix', () => {
    const item = { ...baseItem, itemCount: 1500 };

    const { getByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('1.5k items')).toBeTruthy();
  });

  it('shows content type badge when showContentType is true', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} showContentType />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Flashcard Set')).toBeTruthy();
  });

  it('hides content type badge by default', () => {
    const { queryByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(queryByText('Flashcard Set')).toBeNull();
  });

  it('shows Reviewer Pack type badge', () => {
    const item: MarketplaceItem = { ...baseItem, contentType: 'reviewer_pack' };

    const { getByText } = render(
      <MarketplaceItemCard item={item} showContentType />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Reviewer Pack')).toBeTruthy();
  });

  it('shows Digest type badge', () => {
    const item: MarketplaceItem = { ...baseItem, contentType: 'digest' };

    const { getByText } = render(
      <MarketplaceItemCard item={item} showContentType />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Digest')).toBeTruthy();
  });

  it('shows VoteButtons for digest content type', () => {
    const item: MarketplaceItem = {
      ...baseItem,
      contentType: 'digest',
      voteScore: 7,
    };

    const { getByTestId } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    expect(getByTestId('vote-buttons')).toBeTruthy();
  });

  it('does not show VoteButtons for non-digest content types', () => {
    const { queryByTestId } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    expect(queryByTestId('vote-buttons')).toBeNull();
  });

  it('navigates to flashcard set on press', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Criminal Law Reviewer'));

    expect(router.push).toHaveBeenCalledWith('/study/flashcards/item-1');
  });

  it('navigates to reviewer pack on press', () => {
    const item: MarketplaceItem = {
      ...baseItem,
      id: 'rp-1',
      contentType: 'reviewer_pack',
      title: 'Civ Pro Pack',
    };

    const { getByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Civ Pro Pack'));

    expect(router.push).toHaveBeenCalledWith('/study/reviewer-packs/rp-1');
  });

  it('navigates to digest on press', () => {
    const item: MarketplaceItem = {
      ...baseItem,
      id: 'd-1',
      contentType: 'digest',
      title: 'Marcos v. Manglapus Digest',
    };

    const { getByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Marcos v. Manglapus Digest'));

    expect(router.push).toHaveBeenCalledWith('/digest/d-1');
  });

  it('navigates to contributor profile on creator name press', () => {
    const { getByText } = render(
      <MarketplaceItemCard item={baseItem} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Juan dela Cruz'));

    expect(router.push).toHaveBeenCalledWith('/community/contributors/user-1');
  });

  it('shows expert badge for verified creator', () => {
    const item: MarketplaceItem = {
      ...baseItem,
      creator: {
        id: 'user-2',
        fullName: 'Atty. Santos',
        expertVerification: {
          expertiseType: 'lawyer',
          status: 'approved',
        },
      },
    };

    const { getByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Lawyer')).toBeTruthy();
  });

  it('hides bar subject badge when null', () => {
    const item: MarketplaceItem = { ...baseItem, barSubject: null, topic: null };

    const { queryByText } = render(
      <MarketplaceItemCard item={item} />,
      { wrapper: createWrapper() },
    );

    expect(queryByText('criminal law')).toBeNull();
  });
});
