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
    download: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useAdminDocuments,
  useAdminDocument,
  useAdminDocumentSections,
  usePublishDocument,
  useQuarantineDocument,
} from './use-admin-documents';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useAdminDocuments', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches documents with no params (whitelisted)', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false, limit: 20 } });
    const { result } = renderHook(() => useAdminDocuments(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents', { params: {} });
  });

  it('only forwards defined params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false, limit: 20 } });
    renderHook(
      () =>
        useAdminDocuments({
          status: 'published',
          documentType: 'case',
          court: 'Supreme Court',
          grNo: '12345',
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/documents', {
        params: {
          status: 'published',
          documentType: 'case',
          court: 'Supreme Court',
          grNo: '12345',
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
          limit: '10',
        },
      }),
    );
  });

  it('passes cursor through for pagination', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false, limit: 20 } });
    renderHook(() => useAdminDocuments({ cursor: 'abc-123' }), { wrapper: createWrapper() });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/documents', { params: { cursor: 'abc-123' } }),
    );
  });
});

describe('useAdminDocument', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single document by id', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 'd1', title: 'Test' } });
    const { result } = renderHook(() => useAdminDocument('d1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/d1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useAdminDocument(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAdminDocumentSections', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches sections for a document', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    const { result } = renderHook(() => useAdminDocumentSections('d1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/d1/sections');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useAdminDocumentSections(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('usePublishDocument', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('publishes via POST /documents/:id/publish', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd1', status: 'published' } });
    const { result } = renderHook(() => usePublishDocument(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('d1');
    });
    expect(mockPost).toHaveBeenCalledWith('/documents/d1/publish');
  });

  it('invalidates list and detail queries on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd1' } });
    const { result } = renderHook(() => usePublishDocument(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('d1');
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'document', 'd1'] });
  });

  it('surfaces the API error message verbatim on 400', async () => {
    const apiMessage = 'Cannot publish: 2 high-severity editorial flag(s) still open';
    mockPost.mockRejectedValueOnce(new Error(apiMessage));
    const { result } = renderHook(() => usePublishDocument(), { wrapper: createWrapper() });
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync('d1');
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(apiMessage);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe(apiMessage);
  });
});

describe('useQuarantineDocument', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('quarantines via POST /documents/:id/quarantine', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd1', isPublished: false } });
    const { result } = renderHook(() => useQuarantineDocument(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('d1');
    });
    expect(mockPost).toHaveBeenCalledWith('/documents/d1/quarantine');
  });

  it('invalidates list and detail queries on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd2' } });
    const { result } = renderHook(() => useQuarantineDocument(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('d2');
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'document', 'd2'] });
  });
});
