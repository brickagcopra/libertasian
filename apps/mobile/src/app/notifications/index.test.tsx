import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseNotifications = jest.fn();
const mockUseUnreadCount = jest.fn();
const mockMarkReadMutate = jest.fn();
const mockMarkAllReadMutate = jest.fn();
const mockDeleteMutate = jest.fn();

jest.mock('../../features/workspace/hooks/use-notifications', () => ({
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
  useUnreadCount: () => mockUseUnreadCount(),
  useMarkNotificationRead: () => ({ mutate: mockMarkReadMutate }),
  useMarkAllNotificationsRead: () => ({ mutate: mockMarkAllReadMutate }),
  useDeleteNotification: () => ({ mutate: mockDeleteMutate }),
}));

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => {
      const { View } = require('react-native');
      return <View>{children}</View>;
    },
    {
      Screen: ({ options }: { options?: Record<string, unknown> }) => {
        const { Text } = require('react-native');
        return <Text testID="stack-screen">{String(options?.title ?? '')}</Text>;
      },
    },
  ),
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import { router } from 'expo-router';
import NotificationsScreen from './index';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUnreadCount.mockReturnValue({
      data: { data: { count: 0 } },
    });
  });

  it('shows empty state when no notifications', () => {
    mockUseNotifications.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No notifications')).toBeTruthy();
    expect(
      queryByText(/Notifications from tasks, comments, and digests/),
    ).toBeTruthy();
  });

  it('renders notification rows', () => {
    mockUseNotifications.mockReturnValue({
      data: {
        data: [
          {
            id: 'n1',
            title: 'Task assigned to you',
            body: 'Draft motion for reconsideration',
            type: 'task_assigned',
            isRead: false,
            entityType: 'task',
            entityId: 't1',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'n2',
            title: 'Digest ready',
            body: 'Your digest has been generated',
            type: 'digest_ready',
            isRead: true,
            entityType: 'digest',
            entityId: 'd1',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Task assigned to you')).toBeTruthy();
    expect(queryByText('Draft motion for reconsideration')).toBeTruthy();
    expect(queryByText('Digest ready')).toBeTruthy();
    expect(queryByText('Your digest has been generated')).toBeTruthy();
  });

  it('marks notification as read on press', () => {
    mockUseNotifications.mockReturnValue({
      data: {
        data: [
          {
            id: 'n1',
            title: 'Task assigned',
            body: null,
            type: 'task_assigned',
            isRead: false,
            entityType: 'task',
            entityId: 't1',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Task assigned'));

    expect(mockMarkReadMutate).toHaveBeenCalledWith('n1');
  });

  it('navigates to entity on press', () => {
    mockUseNotifications.mockReturnValue({
      data: {
        data: [
          {
            id: 'n1',
            title: 'Task assigned',
            body: null,
            type: 'task_assigned',
            isRead: true,
            entityType: 'task',
            entityId: 't1',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Task assigned'));

    expect(router.push).toHaveBeenCalledWith('/workspace/tasks/t1');
  });

  it('shows delete confirmation on long press', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockUseNotifications.mockReturnValue({
      data: {
        data: [
          {
            id: 'n1',
            title: 'Notification to delete',
            body: null,
            type: 'share_created',
            isRead: true,
            entityType: null,
            entityId: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent(getByText('Notification to delete'), 'longPress');

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Notification',
      'Remove this notification?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Delete', style: 'destructive' }),
      ]),
    );
  });

  it('displays time ago text', () => {
    mockUseNotifications.mockReturnValue({
      data: {
        data: [
          {
            id: 'n1',
            title: 'Recent notification',
            body: null,
            type: 'task_assigned',
            isRead: false,
            entityType: null,
            entityId: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<NotificationsScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Just now')).toBeTruthy();
  });
});
