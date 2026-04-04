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
  useNotes,
  useNote,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from './use-notes';

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

const mockNote = { id: 'n1', title: 'Research Notes', visibility: 'private', body: {} };

describe('useNotes', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches notes with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockNote],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useNotes(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/notes', {
      params: { limit: '20' },
    });
  });

  it('passes matterId, visibility, search, and cursor params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(
      () =>
        useNotes({
          matterId: 'm1',
          visibility: 'private',
          search: 'contract',
          cursor: 'abc',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/notes', {
        params: {
          limit: '20',
          matterId: 'm1',
          visibility: 'private',
          search: 'contract',
          cursor: 'abc',
        },
      }),
    );
  });

  it('respects custom limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(() => useNotes({ limit: 5 }), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/notes', {
        params: { limit: '5' },
      }),
    );
  });
});

describe('useNote', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single note', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockNote });

    const { result } = renderHook(() => useNote('n1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/notes/n1');
    expect(result.current.data).toEqual(mockNote);
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useNote(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useCreateNote', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a note via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockNote });

    const { result } = renderHook(() => useCreateNote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: 'Research Notes', body: {}, visibility: 'private' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/notes', {
      title: 'Research Notes',
      body: {},
      visibility: 'private',
    });
  });
});

describe('useUpdateNote', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a note via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockNote, title: 'Updated' },
    });

    const { result } = renderHook(() => useUpdateNote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'n1', title: 'Updated' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/notes/n1', { title: 'Updated' });
  });
});

describe('useDeleteNote', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a note via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteNote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('n1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/notes/n1');
  });
});
