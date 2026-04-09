import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationCenterService } from './notification-center.service';
import { NotificationsService } from './notifications.service';
import {
  NOTIFICATION_EVENTS,
  type TaskAssignedEvent,
  type TaskCommentAddedEvent,
  type MatterCommentAddedEvent,
  type DigestReadyEvent,
  type ShareCreatedEvent,
  type SubscriptionNotificationEvent,
} from './notification.events';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly notificationCenterService: NotificationCenterService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
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

  /**
   * Handles subscription lifecycle SEND_NOTIFICATION side effects.
   *
   * The billing service already sends emails for user-initiated actions
   * (immediate cancel, payment success/failure). This handler covers
   * automated lifecycle transitions — specifically when a cancel-at-period-end
   * subscription's period expires (CANCELLING → CANCELLED).
   */
  @OnEvent(NOTIFICATION_EVENTS.SUBSCRIPTION_NOTIFICATION)
  async handleSubscriptionNotification(event: SubscriptionNotificationEvent) {
    try {
      // Period-end cancellation: CANCELLING → CANCELLED
      // (Immediate cancellations from ACTIVE → CANCELLED are already
      // handled by billing.service.cancelSubscription directly)
      if (event.template === 'subscription_cancelled' && event.fromState === 'CANCELLING') {
        await this.sendSubscriptionExpiredEmail(event);
        return;
      }

      this.logger.debug(
        `Subscription notification: template=${event.template} ${event.fromState}→${event.toState}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle subscription notification: ${error}`,
      );
    }
  }

  private async sendSubscriptionExpiredEmail(
    event: SubscriptionNotificationEvent,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: event.subscriptionId },
      select: {
        planCode: true,
        currentPeriodEnd: true,
        organization: {
          select: {
            billingOwner: {
              select: { email: true, fullName: true },
            },
          },
        },
      },
    });

    if (!subscription?.organization?.billingOwner) {
      this.logger.warn(
        `No billing owner found for subscription ${event.subscriptionId}`,
      );
      return;
    }

    const user = subscription.organization.billingOwner;
    const endDate = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : new Date().toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

    await this.notificationsService.sendSubscriptionCancelled({
      email: user.email,
      userName: user.fullName ?? 'User',
      planName: subscription.planCode,
      endDate,
      isImmediate: true, // Period has ended — cancellation is now effective
    });

    this.logger.log(
      `Subscription period-end cancellation email sent for subscription ${event.subscriptionId}`,
    );
  }
}
