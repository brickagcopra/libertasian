import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn().mockResolvedValue(undefined);
const mockDelete = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    setOnUnauthorized: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../../features/feed/hooks/use-create-post', () => ({
  useDeletePost: () => ({ mutate: jest.fn() }),
}));

import { PostOptionsSheet } from '../../../features/feed/components/post-options-sheet';

const AUTHOR = { id: 'author-1', fullName: 'Atty. Maria Santos' };

const post = {
  id: 'post-1',
  organizationId: 'org-1',
  authorId: AUTHOR.id,
  textContent: 'A note on Article III.',
  visibility: 'public',
  status: 'published',
  commentCount: 0,
  likeCount: 0,
  bookmarkCount: 0,
  isPinned: false,
  editedAt: null,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  author: AUTHOR,
  media: null,
  isLikedByMe: false,
  isBookmarkedByMe: false,
} as never;

function renderSheet(isOwner: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PostOptionsSheet
        visible
        post={post}
        isOwner={isOwner}
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onReport={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('PostOptionsSheet — blocking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers Block alongside Report for a non-owner', () => {
    const { getByText } = renderSheet(false);

    expect(getByText('Report Post')).toBeTruthy();
    expect(getByText(`Block ${AUTHOR.fullName}`)).toBeTruthy();
  });

  it('does not offer Block on your own post', () => {
    const { queryByText, getByText } = renderSheet(true);

    expect(queryByText(`Block ${AUTHOR.fullName}`)).toBeNull();
    expect(getByText('Delete Post')).toBeTruthy();
  });

  it('confirms before blocking and does not call the API on cancel', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = renderSheet(false);

    fireEvent.press(getByText(`Block ${AUTHOR.fullName}`));

    expect(alertSpy).toHaveBeenCalledWith(
      `Block ${AUTHOR.fullName}?`,
      expect.stringContaining('no longer see their posts'),
      expect.any(Array),
    );
    expect(mockPost).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('calls the block endpoint with the author id once confirmed', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _msg, buttons) => {
        // Press the destructive "Block" action.
        const confirm = (buttons ?? []).find((b) => b.text === 'Block');
        confirm?.onPress?.();
      });

    const { getByText } = renderSheet(false);
    fireEvent.press(getByText(`Block ${AUTHOR.fullName}`));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(`/feed/users/${AUTHOR.id}/block`);
    });

    alertSpy.mockRestore();
  });
});
