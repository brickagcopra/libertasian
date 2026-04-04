import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/socket', () => ({
  getNotificationSocket: vi.fn(() =>
    Promise.resolve({
      on: vi.fn(),
      off: vi.fn(),
      connect: vi.fn(),
      connected: false,
    }),
  ),
  disconnectNotificationSocket: vi.fn(),
  isSocketConnected: vi.fn(() => false),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: { isAuthenticated: boolean }) => boolean) =>
    selector({ isAuthenticated: true }),
  ),
}));

import { apiClient } from '@/lib/api-client';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
} from './use-notifications';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useNotifications', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches notifications without params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'n1', type: 'task_assigned', isRead: false }],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/notifications', { params: {} });
  });

  it('passes cursor, limit, and isRead params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(
      () => useNotifications({ cursor: 'c1', limit: 10, isRead: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/notifications', {
        params: { cursor: 'c1', limit: '10', isRead: 'false' },
      }),
    );
  });

  it('handles isRead true', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(() => useNotifications({ isRead: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/notifications', {
        params: { isRead: 'true' },
      }),
    );
  });
});

describe('useUnreadCount', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches unread notification count', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { count: 5 },
    });

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/notifications/unread-count');
    expect(result.current.data).toBe(5);
  });
});

describe('useMarkNotificationRead', () => {
  beforeEach(() => mockPatch.mockReset());

  it('marks a notification as read via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { id: 'n1', isRead: true },
    });

    const { result } = renderHook(() => useMarkNotificationRead(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('n1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/notifications/n1/read');
  });
});

describe('useMarkAllNotificationsRead', () => {
  beforeEach(() => mockPost.mockReset());

  it('marks all notifications as read via POST', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { count: 5 },
    });

    const { result } = renderHook(() => useMarkAllNotificationsRead(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/notifications/mark-all-read');
  });
});

describe('useDeleteNotification', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a notification via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteNotification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('n1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/notifications/n1');
  });
});
