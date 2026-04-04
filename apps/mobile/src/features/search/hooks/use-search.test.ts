import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useSearch, useSuggestions } from './use-search';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useSearch', () => {
  it('posts search with query', async () => {
    mockPost.mockResolvedValueOnce({ results: [{ id: 'r1' }], total: 1 });
    const { result } = renderHook(
      () => useSearch({ query: 'res judicata' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/search', { query: 'res judicata' });
  });

  it('is disabled when query is empty', () => {
    const { result } = renderHook(
      () => useSearch({ query: '' }),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when query is whitespace', () => {
    const { result } = renderHook(
      () => useSearch({ query: '   ' }),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(
      () => useSearch({ query: 'test' }, false),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSuggestions', () => {
  it('fetches suggestions', async () => {
    mockGet.mockResolvedValueOnce([{ id: 's1', text: 'res judicata' }]);
    const { result } = renderHook(
      () => useSuggestions('res'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/search/suggestions', { params: { q: 'res', limit: '8' } });
  });

  it('is disabled when query is too short', () => {
    const { result } = renderHook(
      () => useSuggestions('r'),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});
