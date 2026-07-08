import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { registerPushToken } from '../../../lib/push-notifications';
import { usePushNotifications } from './use-push-notifications';

jest.mock('../../../lib/push-notifications', () => ({
  configureNotificationHandler: jest.fn(),
  registerPushToken: jest.fn().mockResolvedValue('ExponentPushToken[test]'),
}));

const mockRegisterPushToken = registerPushToken as jest.MockedFunction<
  typeof registerPushToken
>;
const mockAddResponseListener =
  Notifications.addNotificationResponseReceivedListener as jest.MockedFunction<
    typeof Notifications.addNotificationResponseReceivedListener
  >;
const mockGetLastResponse =
  Notifications.getLastNotificationResponseAsync as jest.MockedFunction<
    typeof Notifications.getLastNotificationResponseAsync
  >;
const mockRouterPush = router.push as jest.MockedFunction<typeof router.push>;

function buildResponse(
  data: Record<string, unknown>,
  identifier = 'req-1',
): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'default',
    notification: {
      date: Date.now(),
      request: {
        identifier,
        content: { data } as Notifications.NotificationContent,
        trigger: null as unknown as Notifications.NotificationTrigger,
      },
    },
  };
}

let queryClient: QueryClient;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLastResponse.mockResolvedValue(null);
  mockAddResponseListener.mockReturnValue({
    remove: jest.fn(),
  } as unknown as Notifications.EventSubscription);
});

describe('usePushNotifications', () => {
  it('registers the push token when authenticated', async () => {
    renderHook(() => usePushNotifications(true), { wrapper: createWrapper() });

    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));
  });

  it('does not register or listen when unauthenticated', () => {
    renderHook(() => usePushNotifications(false), { wrapper: createWrapper() });

    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    expect(mockAddResponseListener).not.toHaveBeenCalled();
  });

  it('deep-links on tap using ENTITY_ROUTES and invalidates notification queries', async () => {
    renderHook(() => usePushNotifications(true), { wrapper: createWrapper() });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => expect(mockAddResponseListener).toHaveBeenCalled());
    const handler = mockAddResponseListener.mock.calls[0]![0];

    handler(
      buildResponse({
        notificationId: 'n1',
        entityType: 'task',
        entityId: 'task-1',
      }),
    );

    expect(mockRouterPush).toHaveBeenCalledWith('/workspace/tasks/task-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['notifications-unread-count'],
    });
  });

  it('ignores unknown entity types without navigating', async () => {
    renderHook(() => usePushNotifications(true), { wrapper: createWrapper() });

    await waitFor(() => expect(mockAddResponseListener).toHaveBeenCalled());
    const handler = mockAddResponseListener.mock.calls[0]![0];

    handler(
      buildResponse({
        notificationId: 'n1',
        entityType: 'unknown',
        entityId: 'x-1',
      }),
    );

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('handles the cold-start tap exactly once (deduped with the listener)', async () => {
    const response = buildResponse(
      { notificationId: 'n2', entityType: 'digest', entityId: 'digest-9' },
      'req-cold',
    );
    mockGetLastResponse.mockResolvedValue(response);

    renderHook(() => usePushNotifications(true), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith('/digests/digest-9'),
    );

    // Same response re-delivered through the listener must be a no-op.
    const handler = mockAddResponseListener.mock.calls[0]![0];
    handler(response);

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });
});
