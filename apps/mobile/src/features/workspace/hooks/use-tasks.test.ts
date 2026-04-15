import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useTasks, useTask, useCreateTask, useUpdateTask, useDeleteTask,
  useTaskComments, useCreateTaskComment, useDeleteTaskComment,
} from './use-tasks';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useTasks', () => {
  it('fetches with default params', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useTasks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/tasks', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useTasks({ status: 'todo', matterId: 'm1', priority: 'high' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/tasks', { params: { status: 'todo', matterId: 'm1', priority: 'high' } });
  });
});

describe('useTask', () => {
  it('fetches single task', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 't1', title: 'Task A' } });
    const { result } = renderHook(() => useTask('t1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useTask(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateTask', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 't2' } });
    const { result } = renderHook(() => useCreateTask(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'New Task' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/tasks', expect.objectContaining({ title: 'New Task' }));
  });
});

describe('useUpdateTask', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 't1' } });
    const { result } = renderHook(() => useUpdateTask(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 't1', title: 'Updated' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/tasks/t1', { title: 'Updated' });
  });
});

describe('useDeleteTask', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteTask(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('t1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/tasks/t1');
  });
});

describe('useTaskComments', () => {
  it('fetches comments for a task', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'c1', body: 'Comment' }] });
    const { result } = renderHook(() => useTaskComments('t1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/tasks/t1/comments');
  });

  it('is disabled when taskId is null', () => {
    const { result } = renderHook(() => useTaskComments(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateTaskComment', () => {
  it('posts comment', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'c2', body: 'New' } });
    const { result } = renderHook(() => useCreateTaskComment(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ taskId: 't1', body: 'New' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/tasks/t1/comments', { body: 'New' });
  });
});

describe('useDeleteTaskComment', () => {
  it('deletes comment', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteTaskComment(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ taskId: 't1', commentId: 'c1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/tasks/t1/comments/c1');
  });
});
