import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FeedCommentItem } from '@libertasian/types';

import { ApiClientError, apiClient } from '../../../lib/api-client';
import { requestCommunityAgreement } from '../../community-guidelines/community-agreement';
import { useReportComment } from '../hooks/use-feed-comments';
import { CommentInput } from './comment-input';
import { CommentList } from './comment-list';
import { REPORT_RECEIVED_MESSAGE, ReportSheet } from './report-sheet';

jest.mock('../../../lib/api-client', () => {
  const actual = jest.requireActual('../../../lib/api-client');
  return {
    ...actual,
    apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockRequestAgreement = requestCommunityAgreement as jest.Mock;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function comment(overrides: Partial<FeedCommentItem> = {}): FeedCommentItem {
  return {
    id: 'c-1',
    postId: 'p-1',
    parentId: null,
    textContent: 'Interesting ruling.',
    likeCount: 0,
    isLikedByMe: false,
    editedAt: null,
    createdAt: new Date().toISOString(),
    author: { id: 'other-user', fullName: 'Juan Dela Cruz' },
    replies: [],
    ...overrides,
  } as FeedCommentItem;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestAgreement.mockResolvedValue(true);
});

describe('useReportComment', () => {
  it('POSTs the reason and details to the comment report endpoint', async () => {
    mockPost.mockResolvedValue({ id: 'r-1' });
    const { result } = renderHook(() => useReportComment(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ commentId: 'c-9', reason: 'harassment', details: 'abusive' });
    });

    expect(mockPost).toHaveBeenCalledWith('/feed/comments/c-9/report', {
      reason: 'harassment',
      details: 'abusive',
    });
  });
});

describe('ReportSheet for a comment', () => {
  it('reports the comment and confirms the 24-hour review', async () => {
    mockPost.mockResolvedValue({ id: 'r-1' });
    const alertSpy = jest.spyOn(Alert, 'alert');
    const onClose = jest.fn();
    const { getByText } = render(
      <ReportSheet visible target={{ type: 'comment', id: 'c-1' }} onClose={onClose} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Report Comment')).toBeTruthy();
    fireEvent.press(getByText('Spam'));
    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Report Submitted', REPORT_RECEIVED_MESSAGE),
    );
    expect(REPORT_RECEIVED_MESSAGE).toMatch(/within 24 hours/);
    expect(mockPost).toHaveBeenCalledWith('/feed/comments/c-1/report', {
      reason: 'spam',
      details: undefined,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server message for a duplicate report', async () => {
    mockPost.mockRejectedValue(new ApiClientError(400, 'You have already reported this comment'));
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(
      <ReportSheet visible target={{ type: 'comment', id: 'c-1' }} onClose={jest.fn()} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Harassment'));
    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Error', 'You have already reported this comment'),
    );
  });

  it('still reports posts through the post endpoint', async () => {
    mockPost.mockResolvedValue({ id: 'r-2' });
    const { getByText } = render(
      <ReportSheet visible target={{ type: 'post', id: 'p-1' }} onClose={jest.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('Report Post')).toBeTruthy();
    fireEvent.press(getByText('Other'));
    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/feed/posts/p-1/report', {
        reason: 'other',
        details: undefined,
      }),
    );
  });
});

describe('CommentList moderation controls', () => {
  function renderList(comments: FeedCommentItem[]) {
    mockGet.mockResolvedValue({
      success: true,
      data: comments,
      meta: { hasNext: false, nextCursor: null },
    });
    return render(<CommentList postId="p-1" currentUserId="me" />, { wrapper: createWrapper() });
  }

  it("offers report and block on someone else's comment, not edit/delete", async () => {
    const { findByText, getByLabelText, queryByLabelText, getByText } = renderList([comment()]);
    await findByText('Interesting ruling.');

    expect(queryByLabelText('Edit comment')).toBeNull();
    expect(queryByLabelText('Delete comment')).toBeNull();

    fireEvent.press(getByLabelText('Comment options'));
    expect(getByText('Report Comment')).toBeTruthy();
    expect(getByText('Block Juan Dela Cruz')).toBeTruthy();
  });

  it('confirms before blocking, then blocks the comment author', async () => {
    mockPost.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { findByText, getByLabelText, getByText } = renderList([comment()]);
    await findByText('Interesting ruling.');

    fireEvent.press(getByLabelText('Comment options'));
    fireEvent.press(getByText('Block Juan Dela Cruz'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Block Juan Dela Cruz?',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Block')?.onPress?.();
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/feed/users/other-user/block'));
  });

  it('keeps edit and delete on the current user’s own comment', async () => {
    const { findByText, getByLabelText, queryByLabelText } = renderList([
      comment({ author: { id: 'me', fullName: 'Me Myself' } } as Partial<FeedCommentItem>),
    ]);
    await findByText('Interesting ruling.');

    expect(getByLabelText('Edit comment')).toBeTruthy();
    expect(getByLabelText('Delete comment')).toBeTruthy();
    expect(queryByLabelText('Comment options')).toBeNull();
  });
});

describe('CommentInput', () => {
  it('sends nothing when the Community Guidelines agreement is cancelled', async () => {
    mockRequestAgreement.mockResolvedValue(false);
    const { getByPlaceholderText, getByText } = render(<CommentInput postId="p-1" />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('Write a comment...'), 'Hello');
    await act(async () => {
      fireEvent.press(getByText('send'));
    });

    expect(mockRequestAgreement).toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('posts once agreed, and shows the server refusal for objectionable language', async () => {
    const refusal =
      "Your comment contains language that isn't allowed under our Community Guidelines. Please revise it.";
    mockPost.mockRejectedValue(new ApiClientError(400, refusal));
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByPlaceholderText, getByText } = render(<CommentInput postId="p-1" />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('Write a comment...'), 'bad words');
    await act(async () => {
      fireEvent.press(getByText('send'));
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error', refusal));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/p-1/comments', {
      textContent: 'bad words',
      parentId: undefined,
    });
  });
});
