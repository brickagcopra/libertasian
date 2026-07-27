import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { documentTypeFilter } from '../document-types';
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
    mockPost.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'r1' }],
      meta: { total: 1, page: 1, limit: 20, hasNext: false },
    });
    const { result } = renderHook(
      () => useSearch({ query: 'res judicata' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/search', { query: 'res judicata' });
  });

  it('returns unwrapped value matching new type', async () => {
    const response = {
      success: true,
      data: [{ id: 'r1', title: 'Case A' }],
      meta: { total: 1, page: 1, limit: 20, hasNext: false },
    };
    mockPost.mockResolvedValueOnce(response);
    const { result } = renderHook(
      () => useSearch({ query: 'res judicata' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toEqual(response.data);
    expect(result.current.data?.meta.total).toBe(1);
  });

  // Representative test for the 5 workspace screens (comparisons, contradictions,
  // hearing-prep, timelines, matters/add-document) that consume useSearch via the
  // `searchData?.data ?? []` access pattern.
  it('supports the screen-side `?.data ?? []` access pattern', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { total: 2, page: 1, limit: 20, hasNext: false },
    });
    const { result } = renderHook(
      () => useSearch({ query: 'evidence' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const items = result.current.data?.data ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe('a');
  });

  // The filter chips used to send legacy abstract values ('case', 'statute', …)
  // that the DTO accepts but no production row carries, so every chip but "All"
  // returned an empty list. They now post the concrete types in the group.
  it('posts a group chip as the full documentType array', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 20, hasNext: false },
    });
    const { result } = renderHook(
      () =>
        useSearch({
          query: 'estafa',
          ...documentTypeFilter('Statutes'),
          limit: 20,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/search', {
      query: 'estafa',
      documentType: [
        'codal',
        'constitution',
        'republic_act',
        'commonwealth_act',
        'batas_pambansa',
        'presidential_decree',
        'executive_order',
        'proclamation',
        'administrative_order',
      ],
      limit: 20,
    });
  });

  it('omits documentType entirely for the "All" chip', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 20, hasNext: false },
    });
    const { result } = renderHook(
      () => useSearch({ query: 'estafa', ...documentTypeFilter('All'), limit: 20 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/search', { query: 'estafa', limit: 20 });
    const body = mockPost.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('documentType');
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
