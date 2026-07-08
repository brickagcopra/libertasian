import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  configureNotificationHandler,
  registerPushToken,
} from '../../../lib/push-notifications';
import { ENTITY_ROUTES } from '../notification-routes';

configureNotificationHandler();

interface PushNotificationData {
  notificationId?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Device push registration + tap handling.
 *
 * - When authenticated (on a real device), requests permission and registers
 *   the Expo push token with the API.
 * - On notification tap (foreground, background, or cold start), refreshes the
 *   notification center queries and deep-links to the referenced entity using
 *   the same ENTITY_ROUTES map as the notification center screen.
 */
export function usePushNotifications(isAuthenticated: boolean): void {
  const queryClient = useQueryClient();
  // Dedupe: the cold-start response can also be re-delivered via the listener.
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    void registerPushToken();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (handledResponseIdRef.current === responseId) return;
      handledResponseIdRef.current = responseId;

      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['notifications-unread-count'],
      });

      const data = response.notification.request.content
        .data as PushNotificationData;
      if (data.entityType && data.entityId) {
        const routeFn = ENTITY_ROUTES[data.entityType];
        if (routeFn) {
          router.push(routeFn(data.entityId));
        }
      }
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Cold start: the tap that launched the app is delivered as the "last"
    // response rather than through the listener.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    });

    return () => {
      subscription.remove();
    };
  }, [isAuthenticated, queryClient]);
}
