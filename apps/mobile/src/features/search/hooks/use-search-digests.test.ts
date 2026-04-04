import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

import { apiClient } from '../../../lib/api-client';
import { useSearchDigests, useDigestCount } from './use-search-digests';

const mockedPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('useSearchDigests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch when documentIds is null', () => {
    const { result } = renderHook(
      () => useSearchDigests(null, false),
      { wrapper: createWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('fetches digests for valid document IDs', async () => {
    const mockData = {
      success: true,
      data: [{ id: 'digest-1', title: 'Test Digest', digestType: 'case_digest', reviewStatus: 'approved', visibility: 'public_editorial', createdAt: '2025-01-01' }],
    };
    mockedPost.mockResolvedValue(mockData);

    const { result } = renderHook(
      () => useSearchDigests(['doc-1'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(mockedPost).toHaveBeenCalledWith('/digests/by-documents', {
      legalDocumentIds: ['doc-1'],
    });
  });
});

describe('useDigestCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch when documentIds is null', () => {
    const { result } = renderHook(
      () => useDigestCount(null, false),
      { wrapper: createWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('fetches count for valid document IDs', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { count: 5 } });

    const { result } = renderHook(
      () => useDigestCount(['doc-1', 'doc-2'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(5);
    });

    expect(mockedPost).toHaveBeenCalledWith('/digests/by-documents/count', {
      legalDocumentIds: ['doc-1', 'doc-2'],
    });
  });

  it('returns 0 for empty document IDs', () => {
    const { result } = renderHook(
      () => useDigestCount([], true),
      { wrapper: createWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
