'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BellIcon, CheckCheckIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useNotificationSocket,
} from '@/features/workspace/hooks/use-notifications';
import type { NotificationItem } from '@/features/workspace/types';

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  task: (id) => `/workspace/tasks/${id}`,
  matter: (id) => `/workspace/matters/${id}`,
  digest: (id) => `/digests/${id}`,
};

export function NotificationBell() {
  useNotificationSocket();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { data: unreadCount } = useUnreadCount();
  const { data: notificationsData, isLoading } = useNotifications({
    limit: 10,
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();

  const notifications = notificationsData?.data ?? [];

  const handleClick = useCallback(
    (notification: NotificationItem) => {
      // Mark as read
      if (!notification.isRead) {
        markRead.mutate(notification.id);
      }

      // Navigate to entity
      if (notification.entityType && notification.entityId) {
        const routeFn = ENTITY_ROUTES[notification.entityType];
        if (routeFn) {
          setOpen(false);
          router.push(routeFn(notification.entityId));
        }
      }
    },
    [markRead, router],
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteNotification.mutate(id);
    },
    [deleteNotification],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <BellIcon className="size-5" />
          {!!unreadCount && unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {!!unreadCount && unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending}
            >
              <CheckCheckIcon className="mr-1 size-3" />
              Mark all read
            </Button>
          )}
        </div>

        {/* List */}
        <div className="max-h-80 overflow-y-auto">
          {isLoading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          )}

          {!isLoading && notifications.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground/70">
              No notifications
            </div>
          )}

          {notifications.map((notification) => (
            <div
              key={notification.id}
              role="button"
              tabIndex={0}
              className={`flex cursor-pointer items-start gap-3 border-b px-4 py-3 transition hover:bg-muted/50 ${
                !notification.isRead ? 'bg-blue-50/50' : ''
              }`}
              onClick={() => handleClick(notification)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleClick(notification);
              }}
            >
              {/* Unread dot */}
              <div className="mt-1.5 shrink-0">
                {!notification.isRead ? (
                  <div className="size-2 rounded-full bg-blue-500" />
                ) : (
                  <div className="size-2" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">
                  {notification.title}
                </p>
                {notification.body && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {notification.body}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {formatTimeAgo(notification.createdAt)}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleDelete(e, notification.id)}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(dateStr).toLocaleDateString();
}
