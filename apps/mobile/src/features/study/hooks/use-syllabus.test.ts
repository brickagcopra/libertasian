import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useSyllabi, useSyllabus, useSyllabusTopic,
  useSyllabusProgress, useBarExamReadiness, useUpsertSyllabusTopicProgress,
} from './use-syllabus';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), put: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPut = apiClient.put as jest.MockedFunction<typeof apiClient.put>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useSyllabi', () => {
  it('fetches all syllabi', async () => {
    mockGet.mockResolvedValueOnce([{ id: 's1', code: 'criminal_law' }]);
    const { result } = renderHook(() => useSyllabi(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/syllabi');
  });
});

describe('useSyllabus', () => {
  it('fetches syllabus by code', async () => {
    mockGet.mockResolvedValueOnce({ id: 's1', code: 'civil_law', topics: [] });
    const { result } = renderHook(() => useSyllabus('civil_law'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/subject/civil_law');
  });

  it('is disabled when code is empty', () => {
    const { result } = renderHook(() => useSyllabus(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSyllabusTopic', () => {
  it('fetches a topic', async () => {
    mockGet.mockResolvedValueOnce({ id: 't1', title: 'Obligations' });
    const { result } = renderHook(() => useSyllabusTopic('s1', 't1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/s1/topics/t1');
  });

  it('is disabled when syllabusId is empty', () => {
    const { result } = renderHook(() => useSyllabusTopic('', 't1'), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when topicId is empty', () => {
    const { result } = renderHook(() => useSyllabusTopic('s1', ''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSyllabusProgress', () => {
  it('fetches progress for a syllabus', async () => {
    mockGet.mockResolvedValueOnce({ completedTopics: 5, totalTopics: 20 });
    const { result } = renderHook(() => useSyllabusProgress('s1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/s1/progress');
  });

  it('is disabled when syllabusId is empty', () => {
    const { result } = renderHook(() => useSyllabusProgress(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBarExamReadiness', () => {
  it('fetches readiness data', async () => {
    mockGet.mockResolvedValueOnce({ overallScore: 72 });
    const { result } = renderHook(() => useBarExamReadiness(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/bar-readiness');
  });
});

describe('useUpsertSyllabusTopicProgress', () => {
  it('puts progress update', async () => {
    mockPut.mockResolvedValueOnce({ topicId: 't1', status: 'completed' });
    const { result } = renderHook(() => useUpsertSyllabusTopicProgress(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ topicId: 't1', data: { status: 'completed' } }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith('/study/syllabi/topics/t1/progress', { status: 'completed' });
  });
});
