import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useBarExamYears,
  useBarExamYear,
  useBarExamSitting,
  useBarExamAnswer,
} from './use-bar-exams';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
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

describe('useBarExamYears', () => {
  it('hits /bar-exams', async () => {
    mockGet.mockResolvedValueOnce([
      { year: 2024, subjects: [] },
      { year: 2022, subjects: [] },
    ]);
    const { result } = renderHook(() => useBarExamYears(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/bar-exams');
  });
});

describe('useBarExamYear', () => {
  it('hits /bar-exams/:year', async () => {
    mockGet.mockResolvedValueOnce({ year: 2024, subjects: [] });
    const { result } = renderHook(() => useBarExamYear(2024), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/bar-exams/2024');
  });

  it('is disabled when year is 0/falsy', () => {
    const { result } = renderHook(() => useBarExamYear(0), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useBarExamSitting', () => {
  it('hits /bar-exams/:year/:subjectCode without part param', async () => {
    mockGet.mockResolvedValueOnce({
      sitting: { id: 's1', year: 2024, questionCount: 0 },
      questions: [],
    });
    const { result } = renderHook(
      () => useBarExamSitting(2024, 'civil_law'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/bar-exams/2024/civil_law', {
      params: undefined,
    });
  });

  it('forwards the part query param when provided', async () => {
    mockGet.mockResolvedValueOnce({
      sitting: { id: 's2', year: 2022, questionCount: 0 },
      questions: [],
    });
    renderHook(() => useBarExamSitting(2022, 'remedial_law', 'I'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/bar-exams/2022/remedial_law', {
      params: { part: 'I' },
    });
  });

  it('url-encodes the subject code', async () => {
    mockGet.mockResolvedValueOnce({
      sitting: { id: 's3', year: 2024, questionCount: 0 },
      questions: [],
    });
    renderHook(() => useBarExamSitting(2024, 'tax/special'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith(
      '/bar-exams/2024/tax%2Fspecial',
      { params: undefined },
    );
  });

  it('is disabled when year or subjectCode is missing', () => {
    const { result } = renderHook(() => useBarExamSitting(0, ''), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useBarExamAnswer', () => {
  it('does not fetch when enabled is false (quota protection)', () => {
    const { result } = renderHook(
      () => useBarExamAnswer('q1', { enabled: false }),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches when enabled is true', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'a1',
      answerText: 'Answer.',
      structuredAnswerJson: null,
      modelRun: null,
      reviewedAt: null,
      question: { id: 'q1', questionNumber: 1, sittingId: 's1' },
    });
    const { result } = renderHook(
      () => useBarExamAnswer('q1', { enabled: true }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/bar-exams/questions/q1/answer');
  });

  it('does not retry on error (deterministic 402/404/429 states)', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => useBarExamAnswer('q1', { enabled: true }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('url-encodes the question id', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'a2',
      answerText: '',
      structuredAnswerJson: null,
      modelRun: null,
      reviewedAt: null,
      question: { id: 'q/2', questionNumber: 1, sittingId: 's1' },
    });
    renderHook(() => useBarExamAnswer('q/2', { enabled: true }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith(
      '/bar-exams/questions/q%2F2/answer',
    );
  });
});
