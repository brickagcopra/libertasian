import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the vote hooks
const mockMutate = vi.fn();
const mockRemoveMutate = vi.fn();
let mockMyVoteData: unknown = { success: true, data: null };

vi.mock('../hooks/use-community-votes', () => ({
  useMyVote: () => ({
    data: mockMyVoteData,
    isLoading: false,
    isError: false,
  }),
  useUpsertVote: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useRemoveVote: () => ({
    mutate: mockRemoveMutate,
    isPending: false,
  }),
}));

import { VoteButtons } from './vote-buttons';

describe('VoteButtons', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockRemoveMutate.mockReset();
    mockMyVoteData = { success: true, data: null };
  });

  it('renders upvote and downvote buttons', () => {
    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('displays vote score when provided', () => {
    render(<VoteButtons entityType="digest" entityId="d1" voteScore={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not display score when voteScore is undefined', () => {
    const { container } = render(
      <VoteButtons entityType="digest" entityId="d1" />,
    );
    // Only buttons, no score text
    const spans = container.querySelectorAll('span');
    const scoreSpans = Array.from(spans).filter((s) =>
      s.className.includes('min-w-[2ch]'),
    );
    expect(scoreSpans).toHaveLength(0);
  });

  it('calls upsertVote with "up" on upvote click when not voted', () => {
    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!); // upvote button

    expect(mockMutate).toHaveBeenCalledWith({
      entityType: 'digest',
      entityId: 'd1',
      voteType: 'up',
    });
  });

  it('calls upsertVote with "down" on downvote click when not voted', () => {
    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]!); // downvote button

    expect(mockMutate).toHaveBeenCalledWith({
      entityType: 'digest',
      entityId: 'd1',
      voteType: 'down',
    });
  });

  it('calls removeVote when clicking same vote type (toggle off)', () => {
    mockMyVoteData = {
      success: true,
      data: { voteType: 'up', id: 'v1' },
    };

    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!); // click upvote when already upvoted

    expect(mockRemoveMutate).toHaveBeenCalledWith({
      entityType: 'digest',
      entityId: 'd1',
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls upsertVote when switching from up to down', () => {
    mockMyVoteData = {
      success: true,
      data: { voteType: 'up', id: 'v1' },
    };

    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]!); // click downvote when currently upvoted

    expect(mockMutate).toHaveBeenCalledWith({
      entityType: 'digest',
      entityId: 'd1',
      voteType: 'down',
    });
  });

  it('applies green styling when upvoted', () => {
    mockMyVoteData = {
      success: true,
      data: { voteType: 'up', id: 'v1' },
    };

    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.className).toContain('bg-green');
  });

  it('applies red styling when downvoted', () => {
    mockMyVoteData = {
      success: true,
      data: { voteType: 'down', id: 'v1' },
    };

    render(<VoteButtons entityType="digest" entityId="d1" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[1]?.className).toContain('bg-red');
  });

  it('applies green text color for positive score', () => {
    render(<VoteButtons entityType="digest" entityId="d1" voteScore={3} />);
    const scoreEl = screen.getByText('3');
    expect(scoreEl.className).toContain('text-green');
  });

  it('applies red text color for negative score', () => {
    render(<VoteButtons entityType="digest" entityId="d1" voteScore={-2} />);
    const scoreEl = screen.getByText('-2');
    expect(scoreEl.className).toContain('text-red');
  });

  it('applies muted text color for zero score', () => {
    render(<VoteButtons entityType="digest" entityId="d1" voteScore={0} />);
    const scoreEl = screen.getByText('0');
    expect(scoreEl.className).toContain('text-muted');
  });
});
