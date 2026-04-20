import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useDerivatives,
  useDerivative,
  useDerivativeSubjects,
} from './use-derivatives';

const mockGet = vi.mocked(apiClient.get);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useDerivatives', () => {
  beforeEach(() => mockGet.mockReset());

  it('requests /derivatives with default limit on initial page', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, limit: 20 },
    });

    const { result } = renderHook(() => useDerivatives(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/derivatives', {
      params: { limit: '20' },
    });
  });

  it('passes subject and type filters', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, limit: 20 },
    });

    const { result } = renderHook(
      () =>
        useDerivatives({
          subjectCode: 'political_law',
          derivativeType: 'mcq_question',
          taxonomyVersion: 'study_8',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/derivatives', {
      params: {
        limit: '20',
        subjectCode: 'political_law',
        derivativeType: 'mcq_question',
        taxonomyVersion: 'study_8',
      },
    });
  });
});

describe('useDerivative', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches detail by ID and unwraps envelope', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { id: 'a-1', title: 'Sample', isGated: false },
    });

    const { result } = renderHook(() => useDerivative('a-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/derivatives/a-1');
    expect(result.current.data).toEqual({ id: 'a-1', title: 'Sample', isGated: false });
  });

  it('is disabled when id is undefined', () => {
    const { result } = renderHook(() => useDerivative(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useDerivativeSubjects', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches subject summary with default taxonomy', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [
        { code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8', count: 3 },
      ],
    });

    const { result } = renderHook(() => useDerivativeSubjects(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/derivatives/subjects/summary', {
      params: { taxonomyVersion: 'study_8' },
    });
    expect(result.current.data).toHaveLength(1);
  });
});
