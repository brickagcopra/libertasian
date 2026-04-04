import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  usePleadings, usePleading, usePleadingTemplates, usePleadingTemplate,
  useGeneratePleading, useDeletePleading,
} from './use-pleadings';

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

describe('usePleadings', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'pl1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => usePleadings(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/pleadings', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => usePleadings({ status: 'completed', category: 'motion' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/pleadings', { params: { status: 'completed', category: 'motion' } });
  });
});

describe('usePleading', () => {
  it('fetches single pleading', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'pl1', status: 'completed' } });
    const { result } = renderHook(() => usePleading('pl1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => usePleading(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('usePleadingTemplates', () => {
  it('fetches templates', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'tmpl1', name: 'Motion to Dismiss' }] });
    const { result } = renderHook(() => usePleadingTemplates(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/pleadings/templates', { params: {} });
  });

  it('filters by category', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    renderHook(() => usePleadingTemplates('motion'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/pleadings/templates', { params: { category: 'motion' } });
  });
});

describe('usePleadingTemplate', () => {
  it('fetches single template', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'tmpl1', body: 'Template body' } });
    const { result } = renderHook(() => usePleadingTemplate('tmpl1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/pleadings/templates/tmpl1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => usePleadingTemplate(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGeneratePleading', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'pl2' } });
    const { result } = renderHook(() => useGeneratePleading(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ templateId: 'tmpl1', matterId: 'm1' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/pleadings/generate', expect.anything());
  });
});

describe('useDeletePleading', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeletePleading(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('pl1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/pleadings/pl1');
  });
});
