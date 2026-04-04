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
  useMatters,
  useMatter,
  useCreateMatter,
  useUpdateMatter,
  useDeleteMatter,
  useMatterDocuments,
  useAddMatterDocument,
  useRemoveMatterDocument,
} from './use-matters';

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

const mockMatter = {
  id: 'm1',
  title: 'People v. Santos',
  status: 'active',
  court: 'Supreme Court',
};

describe('useMatters', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches matters with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockMatter],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useMatters(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/matters', {
      params: { limit: '20' },
    });
  });

  it('passes status, search, and cursor params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(
      () => useMatters({ status: 'active', search: 'Santos', cursor: 'c1' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/matters', {
        params: { limit: '20', status: 'active', search: 'Santos', cursor: 'c1' },
      }),
    );
  });

  it('respects custom limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(() => useMatters({ limit: 10 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/matters', {
        params: { limit: '10' },
      }),
    );
  });
});

describe('useMatter', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single matter by id', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockMatter });

    const { result } = renderHook(() => useMatter('m1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/matters/m1');
    expect(result.current.data).toEqual(mockMatter);
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useMatter(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useCreateMatter', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a matter via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockMatter });

    const { result } = renderHook(() => useCreateMatter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: 'People v. Santos', court: 'Supreme Court' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/matters', {
      title: 'People v. Santos',
      court: 'Supreme Court',
    });
  });
});

describe('useUpdateMatter', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a matter via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockMatter, title: 'Updated' },
    });

    const { result } = renderHook(() => useUpdateMatter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'm1', title: 'Updated' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/matters/m1', { title: 'Updated' });
  });
});

describe('useDeleteMatter', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a matter via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteMatter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('m1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/matters/m1');
  });
});

describe('useMatterDocuments', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches documents for a matter', async () => {
    const docs = [{ id: 'md1', title: 'Complaint', role: 'pleading' }];
    mockGet.mockResolvedValueOnce({ success: true, data: docs });

    const { result } = renderHook(() => useMatterDocuments('m1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/matters/m1/documents');
  });

  it('is disabled when matterId is null', () => {
    const { result } = renderHook(() => useMatterDocuments(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useAddMatterDocument', () => {
  beforeEach(() => mockPost.mockReset());

  it('adds a document to a matter via POST', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'md1', role: 'reference' },
    });

    const { result } = renderHook(() => useAddMatterDocument(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        matterId: 'm1',
        legalDocumentId: 'doc1',
        role: 'reference',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/matters/m1/documents', {
      legalDocumentId: 'doc1',
      role: 'reference',
    });
  });
});

describe('useRemoveMatterDocument', () => {
  beforeEach(() => mockDelete.mockReset());

  it('removes a document from a matter via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useRemoveMatterDocument(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ matterId: 'm1', docId: 'md1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/matters/m1/documents/md1');
  });
});
