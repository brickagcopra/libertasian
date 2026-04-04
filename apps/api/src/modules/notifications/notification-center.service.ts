import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

export interface CreateNotificationPayload {
  userId: string;
  organizationId?: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async createNotification(payload: CreateNotificationPayload) {
    const notification = await this.prisma.notification.create({
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

    this.logger.debug(
      `Notification created: type=${payload.type} user=${payload.userId}`,
    );

    this.gateway.emitToUser(
      payload.userId,
      'notification:created',
      notification,
    );

    return notification;
  }

  async listNotifications(
    userId: string,
    options: { cursor?: string; limit?: number; isRead?: boolean },
  ) {
    const limit = options.limit ?? 20;

    const where: Prisma.NotificationWhereInput = { userId };
    if (options.isRead !== undefined) {
      where.isRead = options.isRead;
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      take: limit + 1,
      ...(options.cursor && { skip: 1, cursor: { id: options.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = notifications.length > limit;
    const items = hasNext ? notifications.slice(0, limit) : notifications;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
        limit,
      },
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return notification;
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    this.gateway.emitToUser(userId, 'notification:read', {
      id: notificationId,
    });

    return updated;
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    this.gateway.emitToUser(userId, 'notification:all-read', {
      count: result.count,
    });

    return { count: result.count };
  }

  async deleteNotification(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({ where: { id: notificationId } });

    this.gateway.emitToUser(userId, 'notification:deleted', {
      id: notificationId,
    });
  }
}
