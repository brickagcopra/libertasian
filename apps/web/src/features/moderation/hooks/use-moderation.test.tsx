import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '@/lib/api-client';
import {
  useCreateSanction,
  useModerationCase,
  useModerationCases,
  useModerationLog,
  useModerationSanctions,
  useModerationStats,
  useResolveCase,
  useRevokeSanction,
} from './use-moderation';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('moderation query hooks unwrap the envelope', () => {
  it('useModerationStats returns data', async () => {
    const stats = { openCases: 3, overdueCases: 1 };
    mockGet.mockResolvedValue({ success: true, data: stats });
    const { wrapper } = setup();
    const { result } = renderHook(() => useModerationStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
    expect(mockGet).toHaveBeenCalledWith('/admin/moderation/stats');
  });

  it('useModerationCases keeps data and meta and sends the query as params', async () => {
    const rows = [{ targetType: 'post', targetId: 'p1' }];
    mockGet.mockResolvedValue({ success: true, data: rows, meta: { total: 30, hasNext: true } });
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useModerationCases({ status: 'open', type: 'feed', sort: 'oldest', limit: 25, offset: 25 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ data: rows, meta: { total: 30, hasNext: true } });
    expect(mockGet).toHaveBeenCalledWith('/admin/moderation/cases', {
      params: { status: 'open', type: 'feed', sort: 'oldest', limit: '25', offset: '25' },
    });
  });

  it('useModerationCase fetches by type and id', async () => {
    mockGet.mockResolvedValue({ success: true, data: { targetId: 'c1', canAct: true } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useModerationCase('comment', 'c1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ targetId: 'c1', canAct: true });
    expect(mockGet).toHaveBeenCalledWith('/admin/moderation/cases/comment/c1');
  });

  it('useModerationSanctions pages by cursor', async () => {
    mockGet
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 's1' }],
        meta: { hasNext: true, nextCursor: 'cur-1' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 's2' }],
        meta: { hasNext: false, nextCursor: null },
      });
    const { wrapper } = setup();
    const { result } = renderHook(() => useModerationSanctions(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    expect(mockGet).toHaveBeenLastCalledWith('/admin/moderation/sanctions', {
      params: { active: 'true', limit: '25' },
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockGet).toHaveBeenLastCalledWith('/admin/moderation/sanctions', {
      params: { active: 'true', limit: '25', cursor: 'cur-1' },
    });
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.data)).toEqual([
        { id: 's1' },
        { id: 's2' },
      ]),
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it('useModerationLog unwraps data and meta', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [{ id: 'a1' }],
      meta: { hasNext: false, nextCursor: null },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useModerationLog(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]).toEqual({
      data: [{ id: 'a1' }],
      meta: { hasNext: false, nextCursor: null },
    });
  });
});

describe('moderation mutations', () => {
  it('useResolveCase posts to resolve, unwraps, and invalidates the moderation prefix', async () => {
    mockPost.mockResolvedValue({ success: true, data: { status: 'resolved' } });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useResolveCase(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({
        targetType: 'post',
        targetId: 'p1',
        input: { decision: 'remove', reason: 'spam', notifyAuthor: true },
      });
    });
    expect(out).toEqual({ status: 'resolved' });
    expect(mockPost).toHaveBeenCalledWith('/admin/moderation/cases/post/p1/resolve', {
      decision: 'remove',
      reason: 'spam',
      notifyAuthor: true,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'moderation'] });
  });

  it('useCreateSanction and useRevokeSanction hit the right paths', async () => {
    mockPost.mockResolvedValue({ success: true, data: { id: 's1' } });
    const { wrapper, invalidate } = setup();
    const create = renderHook(() => useCreateSanction(), { wrapper });
    const revoke = renderHook(() => useRevokeSanction(), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({
        userId: 'u1',
        input: { type: 'suspension', reason: 'harassment', durationDays: 7 },
      });
      await revoke.result.current.mutateAsync({ sanctionId: 's1', input: { note: 'appeal' } });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/moderation/users/u1/sanctions', {
      type: 'suspension',
      reason: 'harassment',
      durationDays: 7,
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/moderation/sanctions/s1/revoke', {
      note: 'appeal',
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
