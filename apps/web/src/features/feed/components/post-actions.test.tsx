import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockLikeMutate = vi.fn();
const mockUnlikeMutate = vi.fn();
const mockBookmarkMutate = vi.fn();
const mockUnbookmarkMutate = vi.fn();

vi.mock('../hooks/use-feed-interactions', () => ({
  useLikePost: () => ({ mutate: mockLikeMutate }),
  useUnlikePost: () => ({ mutate: mockUnlikeMutate }),
  useBookmarkPost: () => ({ mutate: mockBookmarkMutate }),
  useUnbookmarkPost: () => ({ mutate: mockUnbookmarkMutate }),
}));

import { PostActions } from './post-actions';

describe('PostActions', () => {
  const defaultProps = {
    postId: 'post-1',
    likeCount: 5,
    commentCount: 3,
    bookmarkCount: 2,
    isLikedByMe: false,
    isBookmarkedByMe: false,
    onCommentClick: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders like, comment, bookmark, and share buttons', () => {
    const { container } = render(<PostActions {...defaultProps} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(4);
  });

  it('shows like count when greater than 0', () => {
    render(<PostActions {...defaultProps} likeCount={10} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows comment count when greater than 0', () => {
    render(<PostActions {...defaultProps} commentCount={7} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows bookmark count when greater than 0', () => {
    render(<PostActions {...defaultProps} bookmarkCount={4} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('calls likePost when clicking like and not liked', () => {
    const { container } = render(<PostActions {...defaultProps} isLikedByMe={false} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]); // first button is like
    expect(mockLikeMutate).toHaveBeenCalledWith('post-1');
  });

  it('calls unlikePost when clicking like and already liked', () => {
    const { container } = render(<PostActions {...defaultProps} isLikedByMe={true} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(mockUnlikeMutate).toHaveBeenCalledWith('post-1');
  });

  it('calls onCommentClick when clicking comment button', () => {
    const onComment = vi.fn();
    const { container } = render(<PostActions {...defaultProps} onCommentClick={onComment} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[1]); // second button is comment
    expect(onComment).toHaveBeenCalledOnce();
  });

  it('calls bookmarkPost when clicking bookmark and not bookmarked', () => {
    const { container } = render(<PostActions {...defaultProps} isBookmarkedByMe={false} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]); // third button is bookmark
    expect(mockBookmarkMutate).toHaveBeenCalledWith('post-1');
  });

  it('calls unbookmarkPost when clicking bookmark and already bookmarked', () => {
    const { container } = render(<PostActions {...defaultProps} isBookmarkedByMe={true} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]);
    expect(mockUnbookmarkMutate).toHaveBeenCalledWith('post-1');
  });

  it('copies share URL to clipboard when clicking share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { container } = render(<PostActions {...defaultProps} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[3]); // fourth button is share
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('post-1'),
    );
  });
});
