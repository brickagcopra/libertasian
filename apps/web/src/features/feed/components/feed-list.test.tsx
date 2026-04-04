import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./post-card', () => ({
  PostCard: (props: { post: { id: string } }) => (
    <div data-testid={`post-${props.post.id}`}>Post Card</div>
  ),
}));

vi.mock('./feed-skeleton', () => ({
  FeedSkeleton: () => <div data-testid="feed-skeleton">Loading...</div>,
}));

import { FeedList } from './feed-list';
import type { FeedPostItem } from '@libertasian/types';

const makePost = (id: string): FeedPostItem =>
  ({
    id,
    textContent: `Post ${id}`,
    visibility: 'organization',
    isPinned: false,
    likeCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
    isLikedByMe: false,
    isBookmarkedByMe: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    author: { id: 'u1', fullName: 'Test User' },
    media: null,
  }) as FeedPostItem;

describe('FeedList', () => {
  const defaultProps = {
    posts: [] as FeedPostItem[],
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  };

  it('shows skeleton when loading', () => {
    render(<FeedList {...defaultProps} isLoading={true} />);
    expect(screen.getByTestId('feed-skeleton')).toBeInTheDocument();
  });

  it('shows empty message when no posts', () => {
    render(<FeedList {...defaultProps} />);
    expect(screen.getByText('No posts yet.')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(<FeedList {...defaultProps} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders post cards for each post', () => {
    const posts = [makePost('1'), makePost('2'), makePost('3')];
    render(<FeedList {...defaultProps} posts={posts} />);
    expect(screen.getByTestId('post-1')).toBeInTheDocument();
    expect(screen.getByTestId('post-2')).toBeInTheDocument();
    expect(screen.getByTestId('post-3')).toBeInTheDocument();
  });

  it('does not show loading when not fetching next page', () => {
    const posts = [makePost('1')];
    render(<FeedList {...defaultProps} posts={posts} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
