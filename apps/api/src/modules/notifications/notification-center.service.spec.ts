import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationCenterService } from './notification-center.service';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import type { CreateNotificationPayload } from './notification-center.service';

describe('NotificationCenterService', () => {
  let service: NotificationCenterService;
  let prisma: jest.Mocked<PrismaService>;
  let gateway: jest.Mocked<NotificationsGateway>;
  let pushService: { sendToUser: jest.Mock };

  const userId = 'user-1';
  const orgId = 'org-1';

  const mockNotification = {
    id: 'notif-1',
    userId,
    organizationId: orgId,
    type: 'task_assigned',
    title: 'You have a new task',
    body: 'Task: Review contract',
    entityType: 'task',
    entityId: 'task-1',
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-03-20T10:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationCenterService,
        {
          provide: PrismaService,
          useValue: {
            notification: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: NotificationsGateway,
          useValue: {
            emitToUser: jest.fn(),
          },
        },
        {
          provide: PushService,
          useValue: {
            sendToUser: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationCenterService>(NotificationCenterService);
    prisma = module.get(PrismaService);
    gateway = module.get(NotificationsGateway);
    pushService = module.get(PushService);
  });

  // ---- createNotification ----

  describe('createNotification', () => {
    const payload: CreateNotificationPayload = {
      userId,
      organizationId: orgId,
      type: 'task_assigned',
      title: 'You have a new task',
      body: 'Task: Review contract',
      entityType: 'task',
      entityId: 'task-1',
    };

    it('should create a notification and emit via WebSocket', async () => {
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);

      const result = await service.createNotification(payload);

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: payload.userId,
          organizationId: payload.organizationId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          entityType: payload.entityType,
          entityId: payload.entityId,
        },
      });
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'notification:created',
        mockNotification,
      );
      expect(pushService.sendToUser).toHaveBeenCalledWith(userId, {
        title: payload.title,
        body: payload.body,
        data: {
          notificationId: mockNotification.id,
          entityType: payload.entityType,
          entityId: payload.entityId,
        },
      });
    });

    it('should not fail notification creation when push send rejects', async () => {
      (prisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);
      pushService.sendToUser.mockRejectedValue(new Error('expo down'));

      await expect(service.createNotification(payload)).resolves.toEqual(
        mockNotification,
      );
    });

    it('should handle optional fields (body, entityType, entityId)', async () => {
      const minimalPayload: CreateNotificationPayload = {
        userId,
        type: 'system',
        title: 'Welcome!',
      };

      (prisma.notification.create as jest.Mock).mockResolvedValue({
        ...mockNotification,
        body: undefined,
        entityType: undefined,
        entityId: undefined,
        organizationId: undefined,
      });

      await service.createNotification(minimalPayload);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId,
          organizationId: undefined,
          type: 'system',
          title: 'Welcome!',
          body: undefined,
          entityType: undefined,
          entityId: undefined,
        },
      });
    });
  });

  // ---- listNotifications ----

  describe('listNotifications', () => {
    it('should return paginated notifications with default limit', async () => {
      const notifications = Array.from({ length: 21 }, (_, i) => ({
        ...mockNotification,
        id: `notif-${i}`,
      }));
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(notifications);

      const result = await service.listNotifications(userId, {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('notif-19');
      expect(result.meta.limit).toBe(20);
    });

    it('should return all items when under limit', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotification]);

      const result = await service.listNotifications(userId, {});

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.nextCursor).toBeUndefined();
    });

    it('should filter by isRead when provided', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.listNotifications(userId, { isRead: false });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, isRead: false },
        }),
      );
    });

    it('should not filter by isRead when not provided', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.listNotifications(userId, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        }),
      );
    });

    it('should support cursor-based pagination', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.listNotifications(userId, { cursor: 'notif-5' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'notif-5' },
        }),
      );
    });

    it('should support custom limit', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.listNotifications(userId, { limit: 5 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }),
      );
    });

    it('should order by createdAt desc', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.listNotifications(userId, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  // ---- getUnreadCount ----

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      (prisma.notification.count as jest.Mock).mockResolvedValue(5);

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(5);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, isRead: false },
      });
    });

    it('should return 0 when no unread notifications', async () => {
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(0);
    });
  });

  // ---- markAsRead ----

  describe('markAsRead', () => {
    it('should mark an unread notification as read', async () => {
      const unread = { ...mockNotification, isRead: false };
      const updated = { ...mockNotification, isRead: true, readAt: new Date() };

      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(unread);
      (prisma.notification.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.markAsRead('notif-1', userId);

      expect(result).toEqual(updated);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'notification:read',
        { id: 'notif-1' },
      );
    });

    it('should return notification without updating if already read', async () => {
      const alreadyRead = { ...mockNotification, isRead: true, readAt: new Date() };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(alreadyRead);

      const result = await service.markAsRead('notif-1', userId);

      expect(result).toEqual(alreadyRead);
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(gateway.emitToUser).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when notification does not exist', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.markAsRead('notif-999', userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should scope lookup to the requesting user', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);

      await service.markAsRead('notif-1', 'other-user').catch(() => {});

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'other-user' },
      });
    });
  });

  // ---- markAllAsRead ----

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead(userId);

      expect(result).toEqual({ count: 3 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'notification:all-read',
        { count: 3 },
      );
    });

    it('should handle case when no unread notifications exist', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead(userId);

      expect(result).toEqual({ count: 0 });
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'notification:all-read',
        { count: 0 },
      );
    });
  });

  // ---- deleteNotification ----

  describe('deleteNotification', () => {
    it('should delete notification owned by user', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(mockNotification);
      (prisma.notification.delete as jest.Mock).mockResolvedValue(mockNotification);

      await service.deleteNotification('notif-1', userId);

      expect(prisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
      });
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'notification:deleted',
        { id: 'notif-1' },
      );
    });

    it('should throw NotFoundException when notification does not exist', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteNotification('notif-999', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should scope lookup to the requesting user', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);

      await service.deleteNotification('notif-1', 'other-user').catch(() => {});

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'other-user' },
      });
    });
  });
});
