import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock child components and hooks
vi.mock('./post-actions', () => ({
  PostActions: (props: Record<string, unknown>) => (
    <div data-testid="post-actions">
      <button onClick={props.onCommentClick as () => void}>comment-toggle</button>
      <span data-testid="like-count">{String(props.likeCount)}</span>
    </div>
  ),
}));

vi.mock('./post-menu', () => ({
  PostMenu: (props: Record<string, unknown>) => (
    <div data-testid="post-menu" data-post-id={props.postId} />
  ),
}));

vi.mock('./comment-section', () => ({
  CommentSection: (props: Record<string, unknown>) => (
    <div data-testid="comment-section" data-post-id={props.postId} />
  ),
}));

import { PostCard } from './post-card';
import type { FeedPostItem } from '@libertasian/types';

const makePost = (overrides: Partial<FeedPostItem> = {}): FeedPostItem => ({
  id: 'post-1',
  textContent: 'Hello world',
  visibility: 'organization',
  isPinned: false,
  likeCount: 5,
  commentCount: 2,
  bookmarkCount: 1,
  isLikedByMe: false,
  isBookmarkedByMe: false,
  createdAt: new Date().toISOString(),
  editedAt: null,
  author: { id: 'user-1', fullName: 'Juan Dela Cruz' },
  media: null,
  ...overrides,
});

describe('PostCard', () => {
  it('renders author name and text content', () => {
    render(<PostCard post={makePost()} />);
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows author initials in avatar fallback', () => {
    render(<PostCard post={makePost()} />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('shows pinned badge when post is pinned', () => {
    render(<PostCard post={makePost({ isPinned: true })} />);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('does not show pinned badge when not pinned', () => {
    render(<PostCard post={makePost({ isPinned: false })} />);
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
  });

  it('shows edited indicator when editedAt is set', () => {
    render(<PostCard post={makePost({ editedAt: new Date().toISOString() })} />);
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('shows Public badge for public visibility', () => {
    render(<PostCard post={makePost({ visibility: 'public' })} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('truncates long text and shows Read more button', () => {
    const longText = 'A'.repeat(600);
    render(<PostCard post={makePost({ textContent: longText })} />);
    expect(screen.getByText('Read more')).toBeInTheDocument();
  });

  it('expands text when Read more is clicked', () => {
    const longText = 'A'.repeat(600);
    render(<PostCard post={makePost({ textContent: longText })} />);
    fireEvent.click(screen.getByText('Read more'));
    expect(screen.queryByText('Read more')).not.toBeInTheDocument();
  });

  it('does not show Read more for short text', () => {
    render(<PostCard post={makePost({ textContent: 'Short' })} />);
    expect(screen.queryByText('Read more')).not.toBeInTheDocument();
  });

  it('renders post image when media has processedObjectKey', () => {
    const post = makePost({
      media: {
        id: 'media-1',
        processedObjectKey: 'key.jpg',
        width: 800,
        height: 600,
        processingStatus: 'ready',
      } as FeedPostItem['media'],
    });
    render(<PostCard post={post} />);
    const img = screen.getByAltText('Post image');
    expect(img).toBeInTheDocument();
  });

  it('does not render image when no media', () => {
    render(<PostCard post={makePost()} />);
    expect(screen.queryByAltText('Post image')).not.toBeInTheDocument();
  });

  it('renders PostActions with correct props', () => {
    render(<PostCard post={makePost({ likeCount: 42 })} />);
    expect(screen.getByTestId('post-actions')).toBeInTheDocument();
    expect(screen.getByTestId('like-count')).toHaveTextContent('42');
  });

  it('toggles comment section when comment button clicked', () => {
    render(<PostCard post={makePost()} />);
    expect(screen.queryByTestId('comment-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('comment-toggle'));
    expect(screen.getByTestId('comment-section')).toBeInTheDocument();
  });

  it('renders PostMenu with correct postId', () => {
    render(<PostCard post={makePost()} />);
    expect(screen.getByTestId('post-menu')).toHaveAttribute('data-post-id', 'post-1');
  });

  it('shows relative time for recent posts', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    render(<PostCard post={makePost({ createdAt: fiveMinAgo })} />);
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('handles empty text content', () => {
    render(<PostCard post={makePost({ textContent: null as unknown as string })} />);
    expect(screen.getByTestId('post-actions')).toBeInTheDocument();
  });
});
