import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useTasks,
  useTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useTaskComments,
  useCreateTaskComment,
  useDeleteTaskComment,
} from './use-tasks';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

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

const mockTask = { id: 't1', title: 'Review complaint', status: 'open', priority: 'high' };

describe('useTasks', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches tasks with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockTask],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useTasks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/tasks', {
      params: { limit: '20' },
    });
  });

  it('passes all filter params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(
      () =>
        useTasks({
          status: 'open',
          priority: 'high',
          assignedToUserId: 'u1',
          matterId: 'm1',
          search: 'complaint',
          dueBefore: '2026-04-01',
          dueAfter: '2026-03-01',
          cursor: 'c1',
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/tasks', {
        params: {
          limit: '10',
          status: 'open',
          priority: 'high',
          assignedToUserId: 'u1',
          matterId: 'm1',
          search: 'complaint',
          dueBefore: '2026-04-01',
          dueAfter: '2026-03-01',
          cursor: 'c1',
        },
      }),
    );
  });
});

describe('useTask', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single task', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockTask });

    const { result } = renderHook(() => useTask('t1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/tasks/t1');
    expect(result.current.data).toEqual(mockTask);
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useTask(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useCreateTask', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a task via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockTask });

    const { result } = renderHook(() => useCreateTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: 'Review complaint', priority: 'high' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/tasks', {
      title: 'Review complaint',
      priority: 'high',
    });
  });
});

describe('useUpdateTask', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a task via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockTask, status: 'completed' },
    });

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 't1', status: 'completed' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/tasks/t1', { status: 'completed' });
  });
});

describe('useDeleteTask', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a task via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('t1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/tasks/t1');
  });
});

describe('useTaskComments', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches comments for a task', async () => {
    const comments = [{ id: 'tc1', body: 'Looks good', userId: 'u1' }];
    mockGet.mockResolvedValueOnce({ success: true, data: comments });

    const { result } = renderHook(() => useTaskComments('t1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/tasks/t1/comments');
    expect(result.current.data).toEqual(comments);
  });

  it('is disabled when taskId is null', () => {
    const { result } = renderHook(() => useTaskComments(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useCreateTaskComment', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a task comment via POST', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'tc1', body: 'New comment' },
    });

    const { result } = renderHook(() => useCreateTaskComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ taskId: 't1', body: 'New comment' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/tasks/t1/comments', {
      body: 'New comment',
    });
  });
});

describe('useDeleteTaskComment', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a task comment via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteTaskComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ taskId: 't1', commentId: 'tc1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/tasks/t1/comments/tc1');
  });
});
