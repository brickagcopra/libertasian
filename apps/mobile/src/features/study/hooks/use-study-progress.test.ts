import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useStudyProgressList, useStudyProgress, useUpsertStudyProgress } from './use-study-progress';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), patch: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useStudyProgressList', () => {
  it('fetches progress list', async () => {
    mockGet.mockResolvedValueOnce([{ entityType: 'codal', entityId: '1', progress: 50 }]);
    const { result } = renderHook(() => useStudyProgressList(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/progress');
  });
});

describe('useStudyProgress', () => {
  it('fetches single progress record', async () => {
    mockGet.mockResolvedValueOnce({ entityType: 'codal', entityId: '1', progress: 75 });
    const { result } = renderHook(() => useStudyProgress('codal', '1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/progress/codal/1');
  });

  it('is disabled when entityType is empty', () => {
    const { result } = renderHook(() => useStudyProgress('', '1'), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when entityId is empty', () => {
    const { result } = renderHook(() => useStudyProgress('codal', ''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(() => useStudyProgress('codal', '1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpsertStudyProgress', () => {
  it('patches to correct endpoint', async () => {
    mockPatch.mockResolvedValueOnce({ entityType: 'codal', entityId: '1', progress: 100 });
    const { result } = renderHook(() => useUpsertStudyProgress(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ entityType: 'codal', entityId: '1', input: { progress: 100 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/study/progress/codal/1', { progress: 100 });
  });
});
