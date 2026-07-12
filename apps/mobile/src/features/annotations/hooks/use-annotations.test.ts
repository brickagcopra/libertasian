import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
} from './use-annotations';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useAnnotations', () => {
  it('fetches all annotations with no document filter', async () => {
    mockGet.mockResolvedValueOnce([{ id: 'an1' }]);
    const { result } = renderHook(() => useAnnotations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/annotations', { params: {} });
  });

  it('passes legalDocumentId filter', async () => {
    mockGet.mockResolvedValueOnce([]);
    renderHook(() => useAnnotations('doc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/annotations', {
      params: { legalDocumentId: 'doc1' },
    });
  });
});

describe('useCreateAnnotation', () => {
  it('posts annotation with textAnchor', async () => {
    mockPost.mockResolvedValueOnce({ id: 'an2', legalDocumentId: 'doc1' });
    const { result } = renderHook(() => useCreateAnnotation(), { wrapper: createWrapper() });
    const input = {
      legalDocumentId: 'doc1',
      sectionId: 'sec1',
      textAnchor: { startOffset: 0, endOffset: 12, anchorText: 'Hello, court' },
      color: 'green' as const,
    };
    await act(async () => { result.current.mutate(input); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/annotations', input);
  });
});

describe('useDeleteAnnotation', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ message: 'Annotation deleted' });
    const { result } = renderHook(() => useDeleteAnnotation(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('an1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/annotations/an1');
  });
});
