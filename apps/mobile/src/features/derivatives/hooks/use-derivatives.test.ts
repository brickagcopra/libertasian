import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useDerivative,
  useDerivatives,
  useDerivativeSubjects,
} from './use-derivatives';

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

describe('useDerivatives', () => {
  it('fetches first page with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, limit: 20 },
    });
    const { result } = renderHook(() => useDerivatives(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/derivatives', { params: { limit: '20' } });
  });

  it('forwards filter params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, limit: 20 },
    });
    renderHook(
      () =>
        useDerivatives({
          subjectCode: 'criminal_law',
          derivativeType: 'case_digest',
          taxonomyVersion: 'study_8',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/derivatives', {
      params: {
        limit: '20',
        subjectCode: 'criminal_law',
        derivativeType: 'case_digest',
        taxonomyVersion: 'study_8',
      },
    });
  });
});

describe('useDerivative', () => {
  it('fetches detail by id (envelope stripped at transport)', async () => {
    mockGet.mockResolvedValueOnce({ id: 'a1', title: 'Sample' });
    const { result } = renderHook(() => useDerivative('a1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/derivatives/a1');
    expect(result.current.data).toEqual({ id: 'a1', title: 'Sample' });
  });

  it('does not fire when id is empty', () => {
    const { result } = renderHook(() => useDerivative(''), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useDerivativeSubjects', () => {
  it('hits /derivatives/subjects/summary with default taxonomy', async () => {
    mockGet.mockResolvedValueOnce([
      { code: 'x', name: 'X', taxonomyVersion: 'study_8', count: 1 },
    ]);
    const { result } = renderHook(() => useDerivativeSubjects(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/derivatives/subjects/summary', {
      params: { taxonomyVersion: 'study_8' },
    });
  });
});
