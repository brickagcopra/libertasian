import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useDocument, useDocumentSections } from './use-document';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('use-document hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useDocument', () => {
    it('should fetch a document when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'doc-1',
          title: 'Test Case',
          documentType: 'supreme_court_decision',
          status: 'published',
          isOfficial: true,
          isPublished: true,
        },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useDocument('doc-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/documents/doc-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is empty string', () => {
      const { result } = renderHook(() => useDocument(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'));

      const { result } = renderHook(() => useDocument('doc-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('useDocumentSections', () => {
    it('should fetch document sections when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'sec-1',
            sectionType: 'syllabus',
            sectionLabel: 'Syllabus',
            plainText: 'Section text...',
            pageStart: 1,
            pageEnd: 2,
            ordering: 0,
          },
        ],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useDocumentSections('doc-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/documents/doc-1/sections');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is empty string', () => {
      const { result } = renderHook(() => useDocumentSections(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useDocumentSections('doc-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });
});
