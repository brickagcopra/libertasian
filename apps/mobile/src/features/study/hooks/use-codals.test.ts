import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import * as sqliteModule from '../../../storage/sqlite';
import { useCodals, useInfiniteCodals, useOfflineCodals } from './use-codals';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

jest.mock('../../../storage/sqlite', () => ({
  getCachedCodalsBySubject: jest.fn().mockResolvedValue([]),
  saveCodal: jest.fn(),
  removeCachedCodal: jest.fn(),
  getCachedCodal: jest.fn(),
  getCachedSections: jest.fn(),
  cleanStaleCodals: jest.fn(),
  getAllCachedCodalIds: jest.fn(),
  isCodalCached: jest.fn(),
  getCacheStats: jest.fn(),
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockGetCachedBySubject = sqliteModule.getCachedCodalsBySubject as jest.MockedFunction<
  typeof sqliteModule.getCachedCodalsBySubject
>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const mockResponse = {
  data: [{ id: '1', title: 'Civil Code', documentType: 'statute' }],
  meta: { hasNext: false, nextCursor: null },
};

beforeEach(() => jest.clearAllMocks());

describe('useCodals', () => {
  it('fetches codals for a subject', async () => {
    mockGet.mockResolvedValueOnce(mockResponse);
    const { result } = renderHook(() => useCodals({ subject: 'civil_law' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/codals/civil_law', { params: {} });
  });

  it('passes filters as params', async () => {
    mockGet.mockResolvedValueOnce(mockResponse);
    renderHook(() => useCodals({ subject: 'criminal_law', documentType: 'statute', search: 'murder', limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/study/codals/criminal_law', {
      params: { documentType: 'statute', search: 'murder', limit: '10' },
    });
  });

  it('is disabled when subject is empty', () => {
    const { result } = renderHook(() => useCodals({ subject: '' }), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useCodals({ subject: 'civil_law' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useInfiniteCodals', () => {
  it('fetches infinite codals', async () => {
    mockGet.mockResolvedValueOnce(mockResponse);
    const { result } = renderHook(() => useInfiniteCodals({ subject: 'civil_law' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/codals/civil_law', { params: { limit: '20' } });
  });

  it('passes tabGroup to the server', async () => {
    mockGet.mockResolvedValueOnce(mockResponse);
    renderHook(
      () => useInfiniteCodals({ subject: 'civil_law', tabGroup: 'constitutions' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/study/codals/civil_law', {
      params: { limit: '20', tabGroup: 'constitutions' },
    });
  });
});

describe('useCodals — tabGroup param', () => {
  it('passes tabGroup as a query param', async () => {
    mockGet.mockResolvedValueOnce(mockResponse);
    renderHook(
      () => useCodals({ subject: 'civil_law', tabGroup: 'statutes' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/study/codals/civil_law', {
      params: { tabGroup: 'statutes' },
    });
  });
});

describe('useOfflineCodals (fallback)', () => {
  it('loads cached codals from SQLite when enabled', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code', shortTitle: null,
        documentType: 'statute', citationText: 'RA 386', promulgationDate: null,
        isOfficial: true, sectionCount: 10, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('c1');
  });

  it('returns empty array when disabled', async () => {
    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', enabled: false }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(mockGetCachedBySubject).not.toHaveBeenCalled();
  });

  it('filters by documentType client-side', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code', shortTitle: null,
        documentType: 'statute', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 5, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c2', subject: 'civil_law', title: 'EO 209', shortTitle: null,
        documentType: 'executive_order', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 3, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', documentType: 'statute', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].documentType).toBe('statute');
  });

  it('filters by search text client-side', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code of the Philippines', shortTitle: null,
        documentType: 'statute', citationText: 'RA 386', promulgationDate: null,
        isOfficial: true, sectionCount: 5, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c2', subject: 'civil_law', title: 'Family Code', shortTitle: null,
        documentType: 'statute', citationText: 'EO 209', promulgationDate: null,
        isOfficial: true, sectionCount: 3, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', search: 'family', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].title).toBe('Family Code');
  });

  it('filters cached codals by tabGroup (statutes)', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code', shortTitle: null,
        documentType: 'statute', citationText: 'RA 386', promulgationDate: null,
        isOfficial: true, sectionCount: 10, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c2', subject: 'civil_law', title: 'Family Code', shortTitle: null,
        documentType: 'republic_act', citationText: 'EO 209', promulgationDate: null,
        isOfficial: true, sectionCount: 8, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c3', subject: 'civil_law', title: '1987 Constitution', shortTitle: null,
        documentType: 'constitution', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 12, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c4', subject: 'civil_law', title: 'PD 1083', shortTitle: null,
        documentType: 'presidential_decree', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 5, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', tabGroup: 'statutes', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((d) => d.id).sort()).toEqual(['c1', 'c2']);
  });

  it('filters cached codals by tabGroup (constitutions)', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code', shortTitle: null,
        documentType: 'statute', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 10, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c2', subject: 'civil_law', title: '1987 Constitution', shortTitle: null,
        documentType: 'constitution', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 12, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', tabGroup: 'constitutions', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('c2');
  });

  it('tabGroup overrides single documentType filter', async () => {
    mockGetCachedBySubject.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code', shortTitle: null,
        documentType: 'statute', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 10, cachedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'c2', subject: 'civil_law', title: 'Family Code', shortTitle: null,
        documentType: 'republic_act', citationText: null, promulgationDate: null,
        isOfficial: true, sectionCount: 8, cachedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    // documentType:'statute' would normally narrow to c1; tabGroup:'statutes'
    // should override and include both because both ∈ TAB_GROUP_TO_TYPES.statutes.
    const { result } = renderHook(() =>
      useOfflineCodals({
        subject: 'civil_law',
        documentType: 'statute',
        tabGroup: 'statutes',
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((d) => d.id).sort()).toEqual(['c1', 'c2']);
  });

  it('handles SQLite errors gracefully', async () => {
    mockGetCachedBySubject.mockRejectedValueOnce(new Error('db error'));

    const { result } = renderHook(() =>
      useOfflineCodals({ subject: 'civil_law', enabled: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
