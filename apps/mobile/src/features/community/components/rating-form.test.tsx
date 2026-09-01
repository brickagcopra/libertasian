import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RatingForm } from './rating-form';
import * as ratingsHooks from '../hooks/use-community-ratings';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../hooks/use-community-ratings');

const mockUseMyRating = ratingsHooks.useMyRating as jest.MockedFunction<typeof ratingsHooks.useMyRating>;
const mockUseUpsertRating = ratingsHooks.useUpsertRating as jest.MockedFunction<typeof ratingsHooks.useUpsertRating>;
const mockUseDeleteRating = ratingsHooks.useDeleteRating as jest.MockedFunction<typeof ratingsHooks.useDeleteRating>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockMutate = jest.fn();

function setupMocks(existingRating: unknown = null) {
  // `useMyRating` resolves with the UNWRAPPED rating: `apiClient` already
  // strips the { success, data } envelope that GET
  // /community/ratings/mine/:type/:id returns.
  mockUseMyRating.mockReturnValue({
    data: existingRating,
    isLoading: false,
    isSuccess: true,
  } as ReturnType<typeof ratingsHooks.useMyRating>);

  mockUseUpsertRating.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as unknown as ReturnType<typeof ratingsHooks.useUpsertRating>);

  mockUseDeleteRating.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as unknown as ReturnType<typeof ratingsHooks.useDeleteRating>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RatingForm', () => {
  describe('new rating (no existing)', () => {
    beforeEach(() => setupMocks(null));

    it('renders "Rate this content" title', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Rate this content')).toBeTruthy();
    });

    it('renders score label', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Score')).toBeTruthy();
    });

    it('renders title input field', () => {
      const { getByPlaceholderText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByPlaceholderText('Brief summary...')).toBeTruthy();
    });

    it('renders review body input field', () => {
      const { getByPlaceholderText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByPlaceholderText('Share your thoughts...')).toBeTruthy();
    });

    it('renders submit button text as "Submit Rating"', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Submit Rating')).toBeTruthy();
    });

    it('does not show cancel button for new rating', () => {
      const { queryByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(queryByText('Cancel')).toBeNull();
    });
  });

  describe('existing rating (compact view)', () => {
    const existingRating = {
      id: 'r-1',
      userId: 'u-1',
      entityType: 'flashcard_set' as const,
      entityId: 'fs-1',
      score: 4,
      reviewTitle: 'Good set',
      reviewBody: 'Very helpful for bar review.',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    beforeEach(() => setupMocks(existingRating));

    it('renders "Your rating" title in compact view', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Your rating')).toBeTruthy();
    });

    it('displays existing score', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('4/5')).toBeTruthy();
    });

    it('displays existing review title', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Good set')).toBeTruthy();
    });

    it('displays existing review body', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Very helpful for bar review.')).toBeTruthy();
    });

    it('shows Edit button', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Edit')).toBeTruthy();
    });

    it('shows Delete button', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('Delete')).toBeTruthy();
    });

    it('switches to edit mode on Edit press', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      fireEvent.press(getByText('Edit'));

      expect(getByText('Edit your rating')).toBeTruthy();
      expect(getByText('Update Rating')).toBeTruthy();
    });

    it('shows Cancel button in edit mode for existing rating', () => {
      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      fireEvent.press(getByText('Edit'));

      expect(getByText('Cancel')).toBeTruthy();
    });

    it('shows confirmation alert on Delete press', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      const { getByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      fireEvent.press(getByText('Delete'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Delete Rating',
        'Are you sure you want to delete your rating?',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Delete' }),
        ]),
      );
    });
  });

  describe('existing rating without review text', () => {
    const ratingNoReview = {
      id: 'r-2',
      userId: 'u-1',
      entityType: 'flashcard_set' as const,
      entityId: 'fs-1',
      score: 3,
      reviewTitle: null,
      reviewBody: null,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    beforeEach(() => setupMocks(ratingNoReview));

    it('renders compact view without review text', () => {
      const { getByText, queryByText } = render(
        <RatingForm entityType="flashcard_set" entityId="fs-1" />,
        { wrapper: createWrapper() },
      );

      expect(getByText('3/5')).toBeTruthy();
      expect(queryByText('Good set')).toBeNull();
    });
  });
});
