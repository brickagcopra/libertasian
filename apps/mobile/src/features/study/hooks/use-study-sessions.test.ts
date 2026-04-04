import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useStudyStats, useStartStudySession, useEndStudySession } from './use-study-sessions';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useStudyStats', () => {
  it('fetches study stats', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { currentStreak: 5, totalMinutes: 120 } });
    const { result } = renderHook(() => useStudyStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/stats');
    expect(result.current.data).toEqual({ currentStreak: 5, totalMinutes: 120 });
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useStudyStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useStartStudySession', () => {
  it('starts a session', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 's1', barSubject: 'civil_law' } });
    const { result } = renderHook(() => useStartStudySession(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ barSubject: 'civil_law', activityType: 'flashcard_review' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/sessions/start', expect.objectContaining({ barSubject: 'civil_law' }));
  });
});

describe('useEndStudySession', () => {
  it('ends a session', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 's1', durationMinutes: 15 } });
    const { result } = renderHook(() => useEndStudySession(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ sessionId: 's1', input: { cardsReviewed: 10 } }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/sessions/s1/end', { cardsReviewed: 10 });
  });
});
