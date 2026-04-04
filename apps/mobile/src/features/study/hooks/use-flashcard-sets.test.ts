import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useFlashcardSets,
  useFlashcardSet,
  useCreateFlashcardSet,
  useUpdateFlashcardSet,
  useDeleteFlashcardSet,
} from './use-flashcard-sets';

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

const mockList = { data: [{ id: '1', title: 'Set A' }], meta: { hasNext: false } };
const mockSet = { id: '1', title: 'Set A', barSubject: 'civil_law' };

beforeEach(() => jest.clearAllMocks());

describe('useFlashcardSets', () => {
  it('fetches list with default params', async () => {
    mockGet.mockResolvedValueOnce(mockList);
    const { result } = renderHook(() => useFlashcardSets(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets', { params: {} });
  });

  it('passes filter params', async () => {
    mockGet.mockResolvedValueOnce(mockList);
    renderHook(() => useFlashcardSets({ barSubject: 'criminal_law', limit: 10, cursor: 'abc' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets', {
      params: { barSubject: 'criminal_law', limit: '10', cursor: 'abc' },
    });
  });
});

describe('useFlashcardSet', () => {
  it('fetches a single set by id', async () => {
    mockGet.mockResolvedValueOnce(mockSet);
    const { result } = renderHook(() => useFlashcardSet('1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useFlashcardSet(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(() => useFlashcardSet('1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateFlashcardSet', () => {
  it('posts to correct endpoint', async () => {
    mockPost.mockResolvedValueOnce(mockSet);
    const { result } = renderHook(() => useCreateFlashcardSet(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'New Set', barSubject: 'civil_law', visibility: 'private' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/flashcard-sets', expect.objectContaining({ title: 'New Set' }));
  });
});

describe('useUpdateFlashcardSet', () => {
  it('patches to correct endpoint', async () => {
    mockPatch.mockResolvedValueOnce(mockSet);
    const { result } = renderHook(() => useUpdateFlashcardSet('1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'Updated' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/study/flashcard-sets/1', { title: 'Updated' });
  });
});

describe('useDeleteFlashcardSet', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteFlashcardSet(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/study/flashcard-sets/1');
  });
});
