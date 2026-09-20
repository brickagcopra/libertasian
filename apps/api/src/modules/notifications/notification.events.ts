// Event names
export const NOTIFICATION_EVENTS = {
  TASK_ASSIGNED: 'notification.task_assigned',
  TASK_COMMENT_ADDED: 'notification.task_comment_added',
  MATTER_COMMENT_ADDED: 'notification.matter_comment_added',
  DIGEST_READY: 'notification.digest_ready',
  DIGESTS_ASSIGNED: 'notification.digests_assigned',
  SHARE_CREATED: 'notification.share_created',
  COMMUNITY_RATING_RECEIVED: 'notification.community_rating_received',
  EXPERT_VERIFICATION_RESOLVED: 'notification.expert_verification_resolved',
  COMMUNITY_FLAG_ACTIONED: 'notification.community_flag_actioned',
  SUBSCRIPTION_NOTIFICATION: 'subscription.notification',
} as const;

// Event payload interfaces

export interface TaskAssignedEvent {
  taskId: string;
  taskTitle: string;
  assignedToUserId: string;
  assignedByUserId: string;
  assignedByName: string;
  organizationId: string;
}

export interface TaskCommentAddedEvent {
  taskId: string;
  taskTitle: string;
  commentId: string;
  commentBody: string;
  commentByUserId: string;
  commentByName: string;
  /** User IDs to notify (task creator + assignee, excluding commenter) */
  notifyUserIds: string[];
  organizationId: string;
}

export interface MatterCommentAddedEvent {
  matterId: string;
  matterTitle: string;
  commentId: string;
  commentBody: string;
  commentByUserId: string;
  commentByName: string;
  /** User IDs to notify (matter owner, excluding commenter) */
  notifyUserIds: string[];
  organizationId: string;
}

export interface DigestReadyEvent {
  digestId: string;
  digestTitle: string;
  userId: string;
  organizationId: string;
}

/**
 * One or more digests assigned to a reviewer.
 *
 * Deliberately batch-shaped rather than reusing TaskAssignedEvent: a batch of
 * N digests to one person must produce ONE notification, not N, and the task
 * payload carries entityType 'task', which would point the notification's deep
 * link at a task id that does not exist.
 */
export interface DigestsAssignedEvent {
  /** Every digest in this assignment. A single assign sends exactly one id. */
  digestIds: string[];
  /** Title of the first digest — the body when only one was assigned. */
  sampleTitle: string | null;
  assignedToUserId: string;
  assignedByUserId: string;
  assignedByName: string;
  organizationId: string;
}

export interface ShareCreatedEvent {
  shareId: string;
  entityType: string;
  entityId: string;
  entityTitle: string;
  createdByUserId: string;
  createdByName: string;
  organizationId: string;
}

export interface CommunityRatingReceivedEvent {
  ratingId: string;
  entityType: string;
  entityId: string;
  entityTitle: string;
  score: number;
  /** User ID of the content creator to notify */
  contentOwnerUserId: string;
  raterUserId: string;
  raterName: string;
}

export interface ExpertVerificationResolvedEvent {
  verificationId: string;
  userId: string;
  expertiseType: string;
  status: string;
}

export interface CommunityFlagActionedEvent {
  flagId: string;
  entityType: string;
  entityId: string;
  /** User ID of the content owner whose content was actioned */
  contentOwnerUserId: string;
  reason: string;
}

/** Emitted by subscription-lifecycle.service.ts for SEND_NOTIFICATION side effects */
export interface SubscriptionNotificationEvent {
  subscriptionId: string;
  organizationId: string;
  template: string;
  fromState: string;
  toState: string;
  action: string;
}
