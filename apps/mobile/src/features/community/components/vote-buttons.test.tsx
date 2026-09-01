import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { VoteButtons } from './vote-buttons';
import * as voteHooks from '../hooks/use-community-votes';

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

jest.mock('../hooks/use-community-votes');

const mockUseMyVote = voteHooks.useMyVote as jest.MockedFunction<typeof voteHooks.useMyVote>;
const mockUseUpsertVote = voteHooks.useUpsertVote as jest.MockedFunction<typeof voteHooks.useUpsertVote>;
const mockUseRemoveVote = voteHooks.useRemoveVote as jest.MockedFunction<typeof voteHooks.useRemoveVote>;

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

const mockMutate = jest.fn();

function setupMocks(myVoteType: 'up' | 'down' | null = null) {
  // `useMyVote` resolves with the UNWRAPPED vote: `apiClient` already strips
  // the { success, data } envelope that GET /community/votes/mine/:type/:id
  // returns.
  mockUseMyVote.mockReturnValue({
    data: myVoteType
      ? { id: 'v-1', userId: 'u-1', entityType: 'digest', entityId: 'd-1', voteType: myVoteType, createdAt: '', updatedAt: '' }
      : null,
    isLoading: false,
    isSuccess: true,
  } as ReturnType<typeof voteHooks.useMyVote>);

  mockUseUpsertVote.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as unknown as ReturnType<typeof voteHooks.useUpsertVote>);

  mockUseRemoveVote.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as unknown as ReturnType<typeof voteHooks.useRemoveVote>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VoteButtons', () => {
  it('renders thumbs-up-outline and thumbs-down-outline when no vote', () => {
    setupMocks(null);

    const { getByTestId } = render(
      <VoteButtons entityType="digest" entityId="d-1" />,
      { wrapper: createWrapper() },
    );

    expect(getByTestId('icon-thumbs-up-outline')).toBeTruthy();
    expect(getByTestId('icon-thumbs-down-outline')).toBeTruthy();
  });

  it('renders filled thumbs-up when upvoted', () => {
    setupMocks('up');

    const { getByTestId } = render(
      <VoteButtons entityType="digest" entityId="d-1" />,
      { wrapper: createWrapper() },
    );

    expect(getByTestId('icon-thumbs-up')).toBeTruthy();
    expect(getByTestId('icon-thumbs-down-outline')).toBeTruthy();
  });

  it('renders filled thumbs-down when downvoted', () => {
    setupMocks('down');

    const { getByTestId } = render(
      <VoteButtons entityType="digest" entityId="d-1" />,
      { wrapper: createWrapper() },
    );

    expect(getByTestId('icon-thumbs-up-outline')).toBeTruthy();
    expect(getByTestId('icon-thumbs-down')).toBeTruthy();
  });

  it('displays positive vote score', () => {
    setupMocks(null);

    const { getByText } = render(
      <VoteButtons entityType="digest" entityId="d-1" voteScore={5} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('5')).toBeTruthy();
  });

  it('displays negative vote score', () => {
    setupMocks(null);

    const { getByText } = render(
      <VoteButtons entityType="digest" entityId="d-1" voteScore={-3} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('-3')).toBeTruthy();
  });

  it('displays zero vote score', () => {
    setupMocks(null);

    const { getByText } = render(
      <VoteButtons entityType="digest" entityId="d-1" voteScore={0} />,
      { wrapper: createWrapper() },
    );

    expect(getByText('0')).toBeTruthy();
  });

  it('does not display score when voteScore is undefined', () => {
    setupMocks(null);

    const { queryByText } = render(
      <VoteButtons entityType="digest" entityId="d-1" />,
      { wrapper: createWrapper() },
    );

    expect(queryByText(/^-?\d+$/)).toBeNull();
  });
});
