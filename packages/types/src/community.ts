/**
 * Community & Marketplace types — shared across web, mobile, and API.
 * Phase 4: Public discovery, ratings/reviews, community digest curation,
 * and expert contributor verification.
 */

import type { BarSubjectCode, FlashcardVisibility } from './study';

// ─── Enums ──────────────────────────────────────────────────────────────

export type CommunityEntityType = 'flashcard_set' | 'reviewer_pack' | 'digest';

export type VoteEntityType = 'digest';

export type FlagEntityType =
  | 'flashcard_set'
  | 'reviewer_pack'
  | 'digest'
  | 'community_rating';

export type VoteType = 'up' | 'down';

export type FlagReason =
  | 'spam'
  | 'inappropriate'
  | 'copyright'
  | 'inaccurate'
  | 'other';

export type FlagStatus = 'open' | 'dismissed' | 'actioned';

export type ExpertiseType =
  | 'lawyer'
  | 'law_professor'
  | 'judge_retired'
  | 'legal_researcher';

export type ExpertVerificationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked';

export type MarketplaceSortBy =
  | 'newest'
  | 'top_rated'
  | 'most_reviewed'
  | 'trending';

export type MarketplaceContentType =
  | 'flashcard_set'
  | 'reviewer_pack'
  | 'digest';

// ─── Marketplace ────────────────────────────────────────────────────────

export interface MarketplaceCreator {
  id: string;
  fullName: string;
  expertVerification: {
    expertiseType: ExpertiseType;
    status: ExpertVerificationStatus;
  } | null;
}

export interface MarketplaceItem {
  id: string;
  contentType: MarketplaceContentType;
  title: string;
  description: string | null;
  barSubject: BarSubjectCode | null;
  topic: string | null;
  avgRating: number | null;
  ratingCount: number;
  /** Only present on digest items */
  voteScore?: number;
  /** Item count (cardCount for flashcard_set, itemCount for reviewer_pack) */
  itemCount: number;
  creator: MarketplaceCreator;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceFeatured {
  flashcardSets: MarketplaceItem[];
  reviewerPacks: MarketplaceItem[];
  digests: MarketplaceItem[];
}

export interface MarketplaceListResponse {
  items: MarketplaceItem[];
  hasNext: boolean;
  nextCursor: string | null;
}

// ─── Ratings ────────────────────────────────────────────────────────────

export interface CommunityRating {
  id: string;
  userId: string;
  entityType: CommunityEntityType;
  entityId: string;
  score: number;
  reviewTitle: string | null;
  reviewBody: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; fullName: string };
}

export interface RatingAggregate {
  avgRating: number | null;
  ratingCount: number;
  distribution: Record<number, number>;
}

// ─── Votes ──────────────────────────────────────────────────────────────

export interface CommunityVote {
  id: string;
  userId: string;
  entityType: VoteEntityType;
  entityId: string;
  voteType: VoteType;
  createdAt: string;
  updatedAt: string;
}

// ─── Flags ──────────────────────────────────────────────────────────────

export interface CommunityFlag {
  id: string;
  reporterUserId: string;
  entityType: FlagEntityType;
  entityId: string;
  reason: FlagReason;
  details: string | null;
  status: FlagStatus;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reporter?: { id: string; fullName: string };
  resolvedBy?: { id: string; fullName: string } | null;
}

// ─── Expert Verification ────────────────────────────────────────────────

export interface ExpertVerification {
  id: string;
  userId: string;
  expertiseType: ExpertiseType;
  credentialDetails: string | null;
  status: ExpertVerificationStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; fullName: string; email: string };
}

// ─── Contributor Profile ────────────────────────────────────────────────

export interface ContributorProfile {
  user: {
    id: string;
    fullName: string;
    createdAt: string;
  };
  expertVerification: {
    expertiseType: ExpertiseType;
    status: ExpertVerificationStatus;
  } | null;
  stats: {
    flashcardSetCount: number;
    reviewerPackCount: number;
    digestCount: number;
    totalRatingsReceived: number;
    avgRating: number | null;
  };
}
