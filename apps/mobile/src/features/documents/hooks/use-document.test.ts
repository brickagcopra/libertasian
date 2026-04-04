import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useDocument, useDocumentSections, useDocumentSection } from './use-document';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useDocument', () => {
  it('fetches single document', async () => {
    mockGet.mockResolvedValueOnce({ id: 'doc1', title: 'Test Case' });
    const { result } = renderHook(() => useDocument('doc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/doc1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useDocument(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useDocument('doc1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useDocumentSections', () => {
  it('fetches sections', async () => {
    mockGet.mockResolvedValueOnce([{ id: 's1', title: 'Facts' }]);
    const { result } = renderHook(() => useDocumentSections('doc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/doc1/sections');
  });

  it('is disabled when documentId is empty', () => {
    const { result } = renderHook(() => useDocumentSections(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useDocumentSection', () => {
  it('fetches single section', async () => {
    mockGet.mockResolvedValueOnce({ id: 's1', body: 'Section body' });
    const { result } = renderHook(() => useDocumentSection('doc1', 's1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/doc1/sections/s1');
  });

  it('is disabled when documentId is empty', () => {
    const { result } = renderHook(() => useDocumentSection('', 's1'), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when sectionId is empty', () => {
    const { result } = renderHook(() => useDocumentSection('doc1', ''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
