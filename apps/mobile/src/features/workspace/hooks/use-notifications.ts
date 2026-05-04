import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  connectNotificationSocket,
  disconnectNotificationSocket,
  isSocketConnected,
} from '../../../lib/notification-socket';
import type {
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '../types';

export function useNotificationSocket(isAuthenticated: boolean) {
  const queryClient = useQueryClient();
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectNotificationSocket();
      return;
    }

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });
    };

    const setupSocket = async () => {
      const socket = await connectNotificationSocket();
      socket.on('notification:created', invalidateAll);
      socket.on('notification:read', invalidateAll);
      socket.on('notification:all-read', invalidateAll);
      socket.on('notification:deleted', invalidateAll);
    };

    void setupSocket();

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Returning to foreground — reconnect
        void setupSocket();
      } else if (nextAppState.match(/inactive|background/)) {
        // Going to background — disconnect to save battery
        disconnectNotificationSocket();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
      disconnectNotificationSocket();
    };
  }, [isAuthenticated, queryClient]);
}

export function useNotifications(params?: {
  cursor?: string;
  limit?: number;
  isRead?: boolean;
}) {
  const queryParams: Record<string, string> = {};
  if (params?.cursor) queryParams['cursor'] = params.cursor;
  if (params?.limit) queryParams['limit'] = String(params.limit);
  if (params?.isRead !== undefined)
    queryParams['isRead'] = String(params.isRead);

  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () =>
      apiClient.get<NotificationListResponse>('/notifications', {
        params: queryParams,
      }),
    staleTime: 30 * 1000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () =>
      apiClient.get<UnreadCountResponse>('/notifications/unread-count'),
    refetchInterval: () => (isSocketConnected() ? false : 30_000),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<NotificationItem>(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient.post<{ count: number }>('/notifications/mark-all-read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });
    },
  });
}
