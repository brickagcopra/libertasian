import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { apiClient } from '@/lib/api-client';
import CommunityStandingScreen from '@/app/settings/community-standing';
import type { StandingDecision } from '@/features/community-guidelines/use-community-standing';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const alertMock = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

function decision(over: Partial<StandingDecision> = {}): StandingDecision {
  return {
    id: 'd1',
    action: 'remove',
    targetType: 'post',
    targetId: 'p1',
    reason: 'spam',
    preview: 'Buy my bar notes',
    endsAt: null,
    inEffect: true,
    createdAt: '2026-11-18T12:00:00Z',
    appealDeadline: '2026-12-18T12:00:00Z',
    canAppeal: true,
    appeal: null,
    ...over,
  };
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommunityStandingScreen />
    </QueryClientProvider>,
  );
}

describe('CommunityStandingScreen', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    alertMock.mockClear();
  });

  it('shows good standing when there are no decisions', async () => {
    mockGet.mockResolvedValue([]);
    const { findByText } = renderScreen();
    expect(await findByText("You're in good standing")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/community/standing/decisions');
  });

  it('lists a removal with its reason and appeal deadline', async () => {
    mockGet.mockResolvedValue([decision()]);
    const { findByText, getByText } = renderScreen();
    expect(await findByText('Your post was removed')).toBeTruthy();
    expect(getByText(/Spam/)).toBeTruthy();
    expect(getByText('You can appeal until December 18, 2026')).toBeTruthy();
  });

  it('files an appeal once the statement is long enough', async () => {
    mockGet.mockResolvedValue([decision()]);
    mockPost.mockResolvedValue(decision({ canAppeal: false }));
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Appeal this decision'));
    const send = getByLabelText('Send appeal');
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.changeText(getByLabelText('Your appeal'), '  This was a case discussion, not an ad.  ');
    fireEvent.press(getByLabelText('Send appeal'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/community/standing/decisions/d1/appeal', {
        statement: 'This was a case discussion, not an ad.',
      }),
    );
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Appeal sent', expect.any(String)));
  });

  it('shows the outcome of a decided appeal and no appeal button', async () => {
    mockGet.mockResolvedValue([
      decision({
        canAppeal: false,
        appeal: {
          id: 'a1',
          status: 'denied',
          statement: 'x',
          decisionNote: 'Promotional content',
          createdAt: '2026-11-19T12:00:00Z',
          decidedAt: '2026-11-20T12:00:00Z',
        },
      }),
    ]);
    const { findByText, getByText, queryByLabelText } = renderScreen();
    expect(await findByText('Appeal reviewed: decision upheld')).toBeTruthy();
    expect(getByText('Moderator note: Promotional content')).toBeTruthy();
    expect(queryByLabelText('Appeal this decision')).toBeNull();
  });
});
