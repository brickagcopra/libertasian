import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useNotifications, useUnreadCount, useMarkNotificationRead,
  useMarkAllNotificationsRead, useDeleteNotification,
} from './use-notifications';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../lib/notification-socket', () => ({
  connectNotificationSocket: jest.fn().mockResolvedValue({ on: jest.fn(), off: jest.fn() }),
  disconnectNotificationSocket: jest.fn(),
  isSocketConnected: jest.fn().mockReturnValue(false),
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useNotifications', () => {
  it('fetches notifications', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'n1', message: 'Hello' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/notifications', { params: {} });
  });

  it('passes params', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useNotifications({ limit: 10, isRead: false }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/notifications', { params: { limit: '10', isRead: 'false' } });
  });
});

describe('useUnreadCount', () => {
  it('fetches unread count', async () => {
    mockGet.mockResolvedValueOnce({ data: { count: 5 } });
    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/notifications/unread-count');
  });
});

describe('useMarkNotificationRead', () => {
  it('marks as read', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'n1', isRead: true } });
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('n1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/notifications/n1/read');
  });
});

describe('useMarkAllNotificationsRead', () => {
  it('marks all as read', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { count: 3 } });
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/notifications/mark-all-read');
  });
});

describe('useDeleteNotification', () => {
  it('deletes notification', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteNotification(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('n1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/notifications/n1');
  });
});
