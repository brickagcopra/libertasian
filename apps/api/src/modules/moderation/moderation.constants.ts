/**
 * Shared vocabulary for the platform moderation queue.
 * The web contract mirrors this: apps/web/src/features/moderation/types.ts.
 */

export const FEED_TARGET_TYPES = ['post', 'comment'] as const;
export const COMMUNITY_TARGET_TYPES = [
  'flashcard_set',
  'reviewer_pack',
  'digest',
  'community_rating',
] as const;
export const MODERATION_TARGET_TYPES = [...FEED_TARGET_TYPES, ...COMMUNITY_TARGET_TYPES] as const;
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];
export type CommunityTargetType = (typeof COMMUNITY_TARGET_TYPES)[number];

export const MODERATION_TYPE_FILTERS = ['all', 'feed', 'community', ...MODERATION_TARGET_TYPES] as const;
export type ModerationTypeFilter = (typeof MODERATION_TYPE_FILTERS)[number];

export const MODERATION_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'sexual_content',
  'violence_or_self_harm',
  'misinformation',
  'copyright',
  'off_topic',
  'other',
] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

export const REASON_LABELS: Record<ModerationReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech or slurs',
  sexual_content: 'Sexual content',
  violence_or_self_harm: 'Violence or self-harm',
  misinformation: 'Misinformation',
  copyright: 'Copyright',
  off_topic: 'Off-topic',
  other: 'Other',
};

export const SANCTION_TYPES = ['warning', 'suspension', 'ban'] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];
/** Sanctions that restrict participation. Warnings are recorded only. */
export const RESTRICTIVE_SANCTIONS: readonly SanctionType[] = ['suspension', 'ban'];

export const SUSPENSION_DAYS = [1, 3, 7, 30] as const;

export type ModerationActionType =
  | 'dismiss'
  | 'remove'
  | 'restore'
  | 'auto_hide'
  | 'warn'
  | 'suspend'
  | 'ban'
  | 'revoke_sanction'
  | 'appeal_granted'
  | 'appeal_denied';

/**
 * Distinct open reporters at which a post or comment is hidden pending review.
 * Discourse's default is 3. Hide, never delete: a dismissal makes it visible
 * again.
 */
export const AUTO_HIDE_THRESHOLD = 3;

/** The Terms promise review within 24 hours. */
export const SLA_HOURS = 24;
export const SLA_WARNING_HOURS = 12;

export const TARGET_LABELS: Record<ModerationTargetType, string> = {
  post: 'post',
  comment: 'comment',
  flashcard_set: 'flashcard set',
  reviewer_pack: 'reviewer pack',
  digest: 'digest',
  community_rating: 'review',
};

/** Upper bound on report rows read when building the grouped queue. */
export const QUEUE_SCAN_LIMIT = 5000;
/** Resolved cases are listed from this many days back. */
export const RESOLVED_LOOKBACK_DAYS = 90;

/** Reports one user may file in a rolling 24 hours (all report types). */
export const REPORT_DAILY_CAP = 20;

/** Decisions an author can appeal, and for how long after the decision. */
export const APPEALABLE_ACTIONS: readonly ModerationActionType[] = ['remove', 'suspend', 'ban'];
export const APPEAL_WINDOW_DAYS = 30;
export const APPEAL_STATUSES = ['open', 'granted', 'denied'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/** Upper bound on cases in one bulk decision. */
export const BULK_MAX_CASES = 50;
