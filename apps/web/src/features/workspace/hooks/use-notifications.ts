'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  getNotificationSocket,
  disconnectNotificationSocket,
  isSocketConnected,
} from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import type {
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '../types';

export function useNotificationSocket() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectNotificationSocket();
      connectedRef.current = false;
      return;
    }

    let cancelled = false;

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });
    };

    getNotificationSocket().then((socket) => {
      if (cancelled) return;

      socket.on('notification:created', invalidateAll);
      socket.on('notification:read', invalidateAll);
      socket.on('notification:all-read', invalidateAll);
      socket.on('notification:deleted', invalidateAll);

      if (!socket.connected) {
        socket.connect();
      }
      connectedRef.current = true;
    });

    return () => {
      cancelled = true;
      // Cleanup happens via disconnectNotificationSocket on next effect
    };
  }, [isAuthenticated, queryClient]);
}

export function useNotifications(params?: {
  cursor?: string;
  limit?: number;
  isRead?: boolean;
}) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.isRead !== undefined)
        queryParams['isRead'] = String(params.isRead);

      const res = await apiClient.get<NotificationListResponse>(
        '/notifications',
        { params: queryParams },
      );
      return res;
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await apiClient.get<UnreadCountResponse>(
        '/notifications/unread-count',
      );
      return res.data.count;
    },
    refetchInterval: () => (isSocketConnected() ? false : 30_000),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<{ success: boolean; data: NotificationItem }>(
        `/notifications/${id}/read`,
      ),
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
      apiClient.post<{ success: boolean; data: { count: number } }>(
        '/notifications/mark-all-read',
      ),
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
