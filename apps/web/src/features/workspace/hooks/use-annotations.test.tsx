import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
} from './use-annotations';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
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

describe('useAnnotations', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('fetches annotations without filter', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'a1', annotationText: 'Important', color: 'yellow' }],
    });

    const { result } = renderHook(() => useAnnotations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/annotations', { params: {} });
  });

  it('fetches annotations filtered by legalDocumentId', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });

    renderHook(() => useAnnotations('doc1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/annotations', {
        params: { legalDocumentId: 'doc1' },
      }),
    );
  });
});

describe('useCreateAnnotation', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates an annotation via POST', async () => {
    const annotation = {
      id: 'a1',
      legalDocumentId: 'doc1',
      annotationText: 'Key passage',
      color: 'yellow',
    };
    mockPost.mockResolvedValueOnce({ success: true, data: annotation });

    const { result } = renderHook(() => useCreateAnnotation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        legalDocumentId: 'doc1',
        textAnchor: { startOffset: 10, endOffset: 50, anchorText: 'Some text' },
        annotationText: 'Key passage',
        color: 'yellow',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/annotations', {
      legalDocumentId: 'doc1',
      textAnchor: { startOffset: 10, endOffset: 50, anchorText: 'Some text' },
      annotationText: 'Key passage',
      color: 'yellow',
    });
  });
});

describe('useDeleteAnnotation', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes an annotation via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteAnnotation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('a1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/annotations/a1');
  });
});
