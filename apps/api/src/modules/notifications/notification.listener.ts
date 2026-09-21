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
  type DigestAssignedEvent,
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

  /**
   * A reviewer was assigned digests.
   *
   * ONE notification per event, however many digests it carries — a batch of
   * 20 to one person is one piece of news, not twenty. Everything here is
   * best-effort: the assignment has already been written by the time this
   * runs, and a notification failure must never fail or roll it back, so the
   * whole body is inside a catch that only logs.
   */
  @OnEvent(NOTIFICATION_EVENTS.DIGEST_ASSIGNED)
  async handleDigestAssigned(event: DigestAssignedEvent) {
    // Don't notify someone about their own action.
    if (event.assignedToUserId === event.assignedByUserId) return;
    if (event.digestIds.length === 0) return;

    try {
      const count = event.digestIds.length;
      const firstId = event.digestIds[0]!;

      const [actor, digest] = await Promise.all([
        event.assignedByUserId
          ? this.prisma.user.findUnique({
              where: { id: event.assignedByUserId },
              select: { fullName: true },
            })
          : Promise.resolve(null),
        count === 1
          ? // CARVE-OUT: admin operation — cross-tenant by design. The
            // assignee is platform staff and is generally not a member of the
            // digest's organization.
            this.prisma.digest.findUnique({
              where: { id: firstId },
              select: { title: true },
            })
          : Promise.resolve(null),
      ]);

      const actorName = actor?.fullName ?? 'An editor';

      await this.notificationCenterService.createNotification({
        userId: event.assignedToUserId,
        // No organizationId: reviewing the shared corpus is platform work.
        type: 'digest_assigned',
        title:
          count === 1
            ? `${actorName} assigned you a digest to review`
            : `${actorName} assigned you ${count} digests to review`,
        entityType: 'digest',
        ...(digest?.title ? { body: digest.title } : {}),
        // entity_id is a UUID column — only meaningful when there is exactly one.
        ...(count === 1 ? { entityId: firstId } : {}),
      });
    } catch (error) {
      this.logger.error('Failed to create digest_assigned notification', error);
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
