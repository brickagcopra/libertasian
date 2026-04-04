import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useSyllabi,
  useSyllabus,
  useSyllabusTopic,
  useSyllabusProgress,
  useBarExamReadiness,
  useUpsertSyllabusTopicProgress,
} from './use-syllabus';

const mockGet = vi.mocked(apiClient.get);
const mockPut = vi.mocked(apiClient.put);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useSyllabi', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches all syllabi', async () => {
    const syllabi = [
      { id: 's1', code: 'civil_law', name: 'Civil Law', topicCount: 15 },
      { id: 's2', code: 'criminal_law', name: 'Criminal Law', topicCount: 12 },
    ];
    mockGet.mockResolvedValueOnce({ success: true, data: syllabi });

    const { result } = renderHook(() => useSyllabi(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/syllabi');
    expect(result.current.data?.data).toHaveLength(2);
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Failed'));

    const { result } = renderHook(() => useSyllabi(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSyllabus', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a syllabus by code with topics', async () => {
    const syllabus = {
      id: 's1',
      code: 'civil_law',
      name: 'Civil Law',
      topics: [
        { id: 't1', title: 'Obligations', ordering: 1 },
        { id: 't2', title: 'Contracts', ordering: 2 },
      ],
    };
    mockGet.mockResolvedValueOnce({ success: true, data: syllabus });

    const { result } = renderHook(() => useSyllabus('civil_law'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/subject/civil_law');
    expect(result.current.data).toEqual(syllabus);
  });

  it('is disabled when code is empty', () => {
    const { result } = renderHook(() => useSyllabus(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('encodes special characters in code', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });

    renderHook(() => useSyllabus('political & international law'), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        '/study/syllabi/subject/political%20%26%20international%20law',
      ),
    );
  });
});

describe('useSyllabusTopic', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a specific topic', async () => {
    const topic = {
      id: 't1',
      title: 'Obligations',
      description: 'Types and nature of obligations',
    };
    mockGet.mockResolvedValueOnce({ success: true, data: topic });

    const { result } = renderHook(() => useSyllabusTopic('s1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/s1/topics/t1');
    expect(result.current.data).toEqual(topic);
  });

  it('is disabled when syllabusId is empty', () => {
    const { result } = renderHook(() => useSyllabusTopic('', 't1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when topicId is empty', () => {
    const { result } = renderHook(() => useSyllabusTopic('s1', ''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useSyllabusProgress', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches progress for a syllabus', async () => {
    const progress = {
      syllabusId: 's1',
      completedTopics: 8,
      totalTopics: 15,
      completionPercentage: 53.3,
    };
    mockGet.mockResolvedValueOnce({ success: true, data: progress });

    const { result } = renderHook(() => useSyllabusProgress('s1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/syllabi/s1/progress');
    expect(result.current.data).toEqual(progress);
  });

  it('is disabled when syllabusId is empty', () => {
    const { result } = renderHook(() => useSyllabusProgress(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useBarExamReadiness', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches bar exam readiness data', async () => {
    const readiness = {
      overallScore: 72,
      subjects: [
        { code: 'civil_law', score: 85, label: 'Strong' },
        { code: 'criminal_law', score: 60, label: 'Needs Work' },
      ],
    };
    mockGet.mockResolvedValueOnce({ success: true, data: readiness });

    const { result } = renderHook(() => useBarExamReadiness(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/bar-readiness');
    expect(result.current.data).toEqual(readiness);
  });
});

describe('useUpsertSyllabusTopicProgress', () => {
  beforeEach(() => mockPut.mockReset());

  it('upserts topic progress via PUT', async () => {
    const progress = { topicId: 't1', status: 'completed', notes: 'Done' };
    mockPut.mockResolvedValueOnce({ success: true, data: progress });

    const { result } = renderHook(() => useUpsertSyllabusTopicProgress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        topicId: 't1',
        data: { status: 'completed', notes: 'Done' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith('/study/syllabi/topics/t1/progress', {
      status: 'completed',
      notes: 'Done',
    });
  });

  it('handles upsert error', async () => {
    mockPut.mockRejectedValueOnce(new Error('Bad request'));

    const { result } = renderHook(() => useUpsertSyllabusTopicProgress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        topicId: 't1',
        data: { status: 'invalid' },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
