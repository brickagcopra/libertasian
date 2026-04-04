import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { NotificationCenterService } from './notification-center.service';
import {
  NOTIFICATION_EVENTS,
  type TaskAssignedEvent,
  type TaskCommentAddedEvent,
  type MatterCommentAddedEvent,
  type DigestReadyEvent,
  type ShareCreatedEvent,
} from './notification.events';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  @OnEvent(NOTIFICATION_EVENTS.TASK_ASSIGNED)
  async handleTaskAssigned(event: TaskAssignedEvent) {
    // Don't notify if user assigned task to themselves
    if (event.assignedToUserId === event.assignedByUserId) return;

    try {
      await this.notificationCenterService.createNotification({
        userId: event.assignedToUserId,
        organizationId: event.organizationId,
        type: 'task_assigned',
        title: `${event.assignedByName} assigned you a task`,
        body: event.taskTitle,
        entityType: 'task',
        entityId: event.taskId,
      });
    } catch (error) {
      this.logger.error('Failed to create task_assigned notification', error);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_COMMENT_ADDED)
  async handleTaskCommentAdded(event: TaskCommentAddedEvent) {
    try {
      const truncatedBody =
        event.commentBody.length > 100
          ? event.commentBody.substring(0, 100) + '...'
          : event.commentBody;

      await Promise.all(
        event.notifyUserIds.map((userId) =>
          this.notificationCenterService.createNotification({
            userId,
            organizationId: event.organizationId,
            type: 'task_comment_added',
            title: `${event.commentByName} commented on "${event.taskTitle}"`,
            body: truncatedBody,
            entityType: 'task',
            entityId: event.taskId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        'Failed to create task_comment_added notification',
        error,
      );
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.MATTER_COMMENT_ADDED)
  async handleMatterCommentAdded(event: MatterCommentAddedEvent) {
    try {
      const truncatedBody =
        event.commentBody.length > 100
          ? event.commentBody.substring(0, 100) + '...'
          : event.commentBody;

      await Promise.all(
        event.notifyUserIds.map((userId) =>
          this.notificationCenterService.createNotification({
            userId,
            organizationId: event.organizationId,
            type: 'matter_comment_added',
            title: `${event.commentByName} commented on "${event.matterTitle}"`,
            body: truncatedBody,
            entityType: 'matter',
            entityId: event.matterId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        'Failed to create matter_comment_added notification',
        error,
      );
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.DIGEST_READY)
  async handleDigestReady(event: DigestReadyEvent) {
    try {
      await this.notificationCenterService.createNotification({
        userId: event.userId,
        organizationId: event.organizationId,
        type: 'digest_ready',
        title: 'Your digest is ready',
        body: event.digestTitle,
        entityType: 'digest',
        entityId: event.digestId,
      });
    } catch (error) {
      this.logger.error('Failed to create digest_ready notification', error);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.SHARE_CREATED)
  async handleShareCreated(event: ShareCreatedEvent) {
    // This could notify org admins or the entity owner
    // For now we log it — specific notification targets can be added later
    this.logger.debug(
      `Share created: ${event.entityType}/${event.entityId} by ${event.createdByName}`,
    );
  }
}
