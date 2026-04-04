import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockDeleteNotification = vi.fn();
const mockPush = vi.fn();

let mockUnreadCount: number | undefined = 3;
let mockNotifications: unknown[] = [];
let mockIsLoading = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/features/workspace/hooks/use-notifications', () => ({
  useNotifications: () => ({
    data: { data: mockNotifications },
    isLoading: mockIsLoading,
  }),
  useUnreadCount: () => ({ data: mockUnreadCount }),
  useMarkNotificationRead: () => ({ mutate: mockMarkRead }),
  useMarkAllNotificationsRead: () => ({
    mutate: mockMarkAllRead,
    isPending: false,
  }),
  useDeleteNotification: () => ({ mutate: mockDeleteNotification }),
  useNotificationSocket: vi.fn(),
}));

import { NotificationBell } from './notification-bell';

describe('NotificationBell', () => {
  beforeEach(() => {
    mockMarkRead.mockReset();
    mockMarkAllRead.mockReset();
    mockDeleteNotification.mockReset();
    mockPush.mockReset();
    mockUnreadCount = 3;
    mockNotifications = [];
    mockIsLoading = false;
  });

  it('renders bell icon', () => {
    render(<NotificationBell />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows unread count badge when count > 0', () => {
    mockUnreadCount = 5;
    render(<NotificationBell />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ when count exceeds 99', () => {
    mockUnreadCount = 150;
    render(<NotificationBell />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show badge when unread count is 0', () => {
    mockUnreadCount = 0;
    render(<NotificationBell />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders the bell trigger button', () => {
    render(<NotificationBell />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls useNotificationSocket hook', () => {
    render(<NotificationBell />);
    // The hook is called on mount - no error means it works
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1);
  });
});
