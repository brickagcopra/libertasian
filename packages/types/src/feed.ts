/**
 * Community Feed types — shared across web, mobile, and API.
 * Social layer: posts, comments, likes, bookmarks, reports, moderation.
 */

// ─── Enums ──────────────────────────────────────────────────────────────

export type FeedPostVisibility = 'draft' | 'organization' | 'public';

export type FeedPostStatus =
  | 'published'
  | 'hidden'
  | 'removed_by_admin'
  | 'removed_by_author';

export type FeedMediaProcessingStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'quarantined';

export type FeedModerationStatus = 'unreviewed' | 'approved' | 'rejected';

export type FeedCommentStatus =
  | 'published'
  | 'hidden'
  | 'removed_by_admin'
  | 'removed_by_author';

export type FeedReportReason =
  | 'spam'
  | 'inappropriate'
  | 'harassment'
  | 'misinformation'
  | 'copyright'
  | 'other';

export type FeedReportStatus = 'open' | 'dismissed' | 'actioned';

// ─── Author ─────────────────────────────────────────────────────────────

export interface FeedAuthor {
  id: string;
  fullName: string;
}

// ─── Media ──────────────────────────────────────────────────────────────

export interface FeedMediaItem {
  id: string;
  processedObjectKey: string | null;
  thumbnailObjectKey: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  processingStatus: FeedMediaProcessingStatus;
}

export interface FeedMediaStatus {
  mediaId: string;
  processingStatus: FeedMediaProcessingStatus;
  moderationStatus: FeedModerationStatus;
  processedObjectKey: string | null;
  thumbnailObjectKey: string | null;
  width: number | null;
  height: number | null;
  failureReason: string | null;
}

// ─── Post ───────────────────────────────────────────────────────────────

export interface FeedPostItem {
  id: string;
  organizationId: string;
  textContent: string | null;
  visibility: FeedPostVisibility;
  commentCount: number;
  likeCount: number;
  bookmarkCount: number;
  isPinned: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: FeedAuthor;
  media: FeedMediaItem | null;
  isLikedByMe: boolean;
  isBookmarkedByMe: boolean;
}

export interface FeedPostDetail extends FeedPostItem {
  // Future: extended post detail fields
}

// ─── Comment ────────────────────────────────────────────────────────────

export interface FeedCommentItem {
  id: string;
  postId: string;
  textContent: string;
  likeCount: number;
  editedAt: string | null;
  createdAt: string;
  author: FeedAuthor;
  isLikedByMe: boolean;
  replies?: FeedCommentItem[];
  totalReplyCount?: number;
}

// ─── Report ─────────────────────────────────────────────────────────────

export interface FeedPostReport {
  id: string;
  postId: string;
  reason: FeedReportReason;
  details: string | null;
  status: FeedReportStatus;
  createdAt: string;
  reporter: FeedAuthor;
  post: {
    id: string;
    textContent: string | null;
    status: FeedPostStatus;
    author: FeedAuthor;
  };
}

// ─── Pagination ─────────────────────────────────────────────────────────

export interface FeedPaginationMeta {
  hasNext: boolean;
  nextCursor: string | null;
}
