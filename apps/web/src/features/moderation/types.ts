/**
 * Contract for the platform moderation API (`/admin/moderation/*`).
 *
 * Mirrors apps/api/src/modules/moderation/moderation.types.ts. Every endpoint
 * returns the usual `{ success: true, data, meta? }` envelope and requires the
 * PLATFORM permission `community:moderate` (JwtAuthGuard + MfaGuard +
 * PlatformPermissionsGuard).
 */

/** What a case is about. One case = one reported target, holding N reports. */
export type ModerationTargetType =
  | 'post'
  | 'comment'
  | 'flashcard_set'
  | 'reviewer_pack'
  | 'digest'
  | 'community_rating';

/** Queue filter. `feed` = post + comment; `community` = the four study types. */
export type ModerationTypeFilter = 'all' | 'feed' | 'community' | ModerationTargetType;

export type ModerationCaseStatus = 'open' | 'resolved';

export type ModerationSort = 'oldest' | 'newest' | 'most_reported';

/**
 * Normalised visibility of the reported content.
 * - visible: live for users
 * - hidden: auto-hidden after the report threshold, pending review
 * - removed: removed by a moderator (restorable)
 * - deleted: deleted by its author (not restorable here)
 * - unknown: the target row no longer exists
 */
export type ModerationContentStatus = 'visible' | 'hidden' | 'removed' | 'deleted' | 'unknown';

/** Moderator-selected reason for a removal or sanction. */
export type ModerationReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'sexual_content'
  | 'violence_or_self_harm'
  | 'misinformation'
  | 'copyright'
  | 'off_topic'
  | 'other';

export type SanctionType = 'warning' | 'suspension' | 'ban';

/** Suspension lengths the API accepts. */
export const SUSPENSION_DAYS = [1, 3, 7, 30] as const;
export type SuspensionDays = (typeof SUSPENSION_DAYS)[number];

export type ModerationActionType =
  | 'dismiss'
  | 'remove'
  | 'restore'
  | 'auto_hide'
  | 'warn'
  | 'suspend'
  | 'ban'
  | 'revoke_sanction';

export interface ModerationUserRef {
  id: string;
  fullName: string;
}

/** GET /admin/moderation/cases → data: ModerationCaseSummary[], meta: { total, hasNext } */
export interface ModerationCaseSummary {
  targetType: ModerationTargetType;
  targetId: string;
  /** Open reports when the case is open; all reports when resolved. */
  reportCount: number;
  /** Report reason → count, e.g. { spam: 2, harassment: 1 }. */
  reasons: Record<string, number>;
  firstReportedAt: string;
  lastReportedAt: string;
  /** First ~280 chars of the content (title for study items). */
  preview: string | null;
  author: ModerationUserRef | null;
  contentStatus: ModerationContentStatus;
  /** True when the content is hidden because it reached the report threshold. */
  autoHidden: boolean;
  status: ModerationCaseStatus;
  /** Set for resolved cases. */
  resolution: 'dismissed' | 'actioned' | null;
  resolvedAt: string | null;
}

export interface ModerationCasesQuery {
  status?: ModerationCaseStatus; // default 'open'
  type?: ModerationTypeFilter; // default 'all'
  sort?: ModerationSort; // default 'oldest'
  limit?: number; // default 25, max 100
  offset?: number; // default 0
}

export interface ModerationCasesMeta {
  total: number;
  hasNext: boolean;
}

/** GET /admin/moderation/stats */
export interface ModerationStats {
  openCases: number;
  openReports: number;
  /** Open cases whose first report is older than 24h (the Terms' promise). */
  overdueCases: number;
  /** Open cases 12–24h old. */
  dueSoonCases: number;
  oldestOpenAt: string | null;
  resolvedLast7d: number;
  /** Median first-report → resolution time over cases resolved in the last 7 days. */
  medianResolutionHours7d: number | null;
  activeSanctions: number;
}

export interface ModerationReport {
  id: string;
  reason: string;
  details: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: string;
  reporter: ModerationUserRef;
  resolvedBy: ModerationUserRef | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface ModerationSanction {
  id: string;
  user: ModerationUserRef;
  type: SanctionType;
  reason: ModerationReason;
  note: string | null;
  startsAt: string;
  /** null = permanent (bans) or not applicable (warnings). */
  endsAt: string | null;
  revokedAt: string | null;
  issuedBy: ModerationUserRef | null;
  revokedBy: ModerationUserRef | null;
  createdAt: string;
  /** Suspension/ban currently restricting the user. Warnings are never active. */
  active: boolean;
}

export interface ModerationActionEntry {
  id: string;
  action: ModerationActionType;
  targetType: ModerationTargetType | 'user';
  targetId: string;
  subjectUser: ModerationUserRef | null;
  /** null for automatic actions (auto_hide). */
  moderator: ModerationUserRef | null;
  reason: ModerationReason | null;
  note: string | null;
  reportsResolved: number;
  createdAt: string;
}

/** GET /admin/moderation/users/:userId */
export interface ModerationAuthorProfile {
  id: string;
  fullName: string;
  joinedAt: string;
  /** users.status: active | pending_deletion | deleted */
  accountStatus: string;
  activeSanction: ModerationSanction | null;
  /** Most recent first, up to 20. */
  sanctions: ModerationSanction[];
  stats: {
    posts: number;
    comments: number;
    /** Posts + comments currently removed by a moderator. */
    removedContent: number;
    /** All reports ever filed against this user's posts and comments. */
    reportsAgainst: number;
    /** Of those, reports resolved as 'actioned'. */
    upheldReports: number;
  };
  /** Moderation actions where this user was the subject, newest first, up to 20. */
  history: ModerationActionEntry[];
}

/** GET /admin/moderation/cases/:targetType/:targetId */
export interface ModerationCaseDetail extends ModerationCaseSummary {
  content: {
    /** Study-item title or review title; null for posts/comments. */
    title: string | null;
    body: string | null;
    /** Raw status/visibility column, for display. */
    rawStatus: string | null;
    createdAt: string | null;
    editedAt: string | null;
  };
  /** For a comment: its parent post. Otherwise null. */
  context: {
    targetType: 'post';
    targetId: string;
    preview: string | null;
    author: ModerationUserRef | null;
  } | null;
  /** Every report on this target, newest first. */
  reports: ModerationReport[];
  authorProfile: ModerationAuthorProfile | null;
  /** Moderation actions on this target, newest first. */
  history: ModerationActionEntry[];
  /** False when the moderator is the content's author (server refuses too). */
  canAct: boolean;
  canRemove: boolean;
  canRestore: boolean;
}

/** POST /admin/moderation/cases/:targetType/:targetId/resolve → data: ModerationCaseDetail */
export interface ResolveCaseInput {
  decision: 'dismiss' | 'remove';
  /** Required when decision = 'remove'. */
  reason?: ModerationReason;
  note?: string; // ≤ 1000 chars
  /** Default true. Only applies to 'remove'. */
  notifyAuthor?: boolean;
}

/** POST /admin/moderation/content/:targetType/:targetId/restore → data: ModerationCaseDetail */
export interface RestoreContentInput {
  note?: string;
}

/** POST /admin/moderation/users/:userId/sanctions → data: ModerationSanction */
export interface CreateSanctionInput {
  type: SanctionType;
  reason: ModerationReason;
  note?: string; // ≤ 1000 chars
  /** Required for 'suspension'. */
  durationDays?: SuspensionDays;
  /** 'ban' only: also remove all the user's published posts and comments. */
  removeContent?: boolean;
  /** Default true. */
  notifyUser?: boolean;
}

/** POST /admin/moderation/sanctions/:id/revoke → data: ModerationSanction */
export interface RevokeSanctionInput {
  note?: string;
}

/** GET /admin/moderation/sanctions?active=true|false&limit&cursor → data: ModerationSanction[], meta: { hasNext, nextCursor } */
/** GET /admin/moderation/log?limit&cursor → data: ModerationActionEntry[], meta: { hasNext, nextCursor } */
export interface CursorMeta {
  hasNext: boolean;
  nextCursor: string | null;
}

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

export const TARGET_TYPE_LABELS: Record<ModerationTargetType, string> = {
  post: 'Post',
  comment: 'Comment',
  flashcard_set: 'Flashcard set',
  reviewer_pack: 'Reviewer pack',
  digest: 'Digest',
  community_rating: 'Review',
};
