import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useDocumentCitations,
  useRelatedDocuments,
} from './use-documents';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useDocumentCitations', () => {
  it('fetches citations for a document', async () => {
    mockGet.mockResolvedValueOnce([
      {
        id: 'c1',
        legalDocumentId: 'doc1',
        citedDocumentId: 'doc2',
        citationText: 'G.R. No. 12345',
        citationType: 'case_citation',
      },
    ]);
    const { result } = renderHook(() => useDocumentCitations('doc1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/doc1/citations');
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled when documentId is empty', () => {
    const { result } = renderHook(() => useDocumentCitations(''), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(
      () => useDocumentCitations('doc1', false),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRelatedDocuments', () => {
  it('fetches related documents', async () => {
    mockGet.mockResolvedValueOnce([
      {
        id: 'related1',
        title: 'Related Case',
        documentType: 'case_decision',
        relevanceScore: 0.85,
      },
    ]);
    const { result } = renderHook(() => useRelatedDocuments('doc1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/documents/doc1/related');
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled when documentId is empty', () => {
    const { result } = renderHook(() => useRelatedDocuments(''), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(
      () => useRelatedDocuments('doc1', false),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});
