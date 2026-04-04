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
  useReviewerPacks,
  useReviewerPack,
  useCreateReviewerPack,
  useUpdateReviewerPack,
  useDeleteReviewerPack,
  useAddReviewerPackItem,
  useUpdateReviewerPackItem,
  useDeleteReviewerPackItem,
} from './use-reviewer-packs';

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

const mockPack = {
  id: 'rp1',
  title: 'Constitutional Law Reviewer',
  barSubject: 'political_law',
  visibility: 'private',
  itemCount: 15,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useReviewerPacks', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches reviewer packs with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockPack],
      meta: { hasNext: false, nextCursor: null },
    });

    const { result } = renderHook(() => useReviewerPacks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs', {
      params: { limit: '20' },
    });
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('passes barSubject, visibility, and cursor params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, nextCursor: null },
    });

    renderHook(
      () =>
        useReviewerPacks({
          barSubject: 'remedial_law',
          visibility: 'org',
          cursor: 'cur1',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs', {
        params: {
          limit: '20',
          barSubject: 'remedial_law',
          visibility: 'org',
          cursor: 'cur1',
        },
      }),
    );
  });
});

describe('useReviewerPack', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single reviewer pack with items', async () => {
    const packWithItems = {
      ...mockPack,
      items: [{ id: 'item1', title: 'Item 1', referenceType: 'document' }],
    };
    mockGet.mockResolvedValueOnce({ success: true, data: packWithItems });

    const { result } = renderHook(() => useReviewerPack('rp1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs/rp1');
    expect(result.current.data).toEqual(packWithItems);
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useReviewerPack(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useCreateReviewerPack', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a reviewer pack via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockPack });

    const { result } = renderHook(() => useCreateReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        title: 'Constitutional Law Reviewer',
        barSubject: 'political_law',
        visibility: 'private',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/reviewer-packs', {
      title: 'Constitutional Law Reviewer',
      barSubject: 'political_law',
      visibility: 'private',
    });
  });
});

describe('useUpdateReviewerPack', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a reviewer pack via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockPack, title: 'Updated Pack' },
    });

    const { result } = renderHook(() => useUpdateReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'rp1', data: { title: 'Updated Pack' } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/study/reviewer-packs/rp1', {
      title: 'Updated Pack',
    });
  });
});

describe('useDeleteReviewerPack', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a reviewer pack via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('rp1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/study/reviewer-packs/rp1');
  });
});

describe('useAddReviewerPackItem', () => {
  beforeEach(() => mockPost.mockReset());

  it('adds an item to a reviewer pack via POST', async () => {
    const item = { id: 'item1', referenceType: 'document', referenceId: 'doc1' };
    mockPost.mockResolvedValueOnce({ success: true, data: item });

    const { result } = renderHook(() => useAddReviewerPackItem(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        packId: 'rp1',
        data: { referenceType: 'document', referenceId: 'doc1' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/reviewer-packs/rp1/items', {
      referenceType: 'document',
      referenceId: 'doc1',
    });
  });
});

describe('useUpdateReviewerPackItem', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a reviewer pack item via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { id: 'item1', notes: 'Updated notes' },
    });

    const { result } = renderHook(() => useUpdateReviewerPackItem(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        id: 'item1',
        packId: 'rp1',
        data: { notes: 'Updated notes' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/study/reviewer-pack-items/item1', {
      notes: 'Updated notes',
    });
  });
});

describe('useDeleteReviewerPackItem', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a reviewer pack item via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteReviewerPackItem(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'item1', packId: 'rp1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/study/reviewer-pack-items/item1');
  });
});
