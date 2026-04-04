/**
 * Community & Marketplace mobile feature types.
 * Mirrors the shared types from @libertasian/types/community
 * with API response envelopes for the mobile client.
 */

// ─── Entity Types ───────────────────────────────────────────────────────

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

// ─── Data Structures ────────────────────────────────────────────────────

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
  barSubject: string | null;
  topic: string | null;
  avgRating: number | null;
  ratingCount: number;
  voteScore?: number;
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

export interface CommunityVote {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  voteType: VoteType;
  createdAt: string;
  updatedAt: string;
}

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
}

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

// ─── Marketplace Query ──────────────────────────────────────────────────

export interface MarketplaceQueryParams {
  cursor?: string;
  limit?: number;
  barSubject?: string;
  search?: string;
  sortBy?: MarketplaceSortBy;
}

// ─── API Response Envelopes ─────────────────────────────────────────────

export interface MarketplaceListResponse {
  success: boolean;
  data: {
    items: MarketplaceItem[];
    hasNext: boolean;
    nextCursor: string | null;
  };
}

export interface MarketplaceFeaturedResponse {
  success: boolean;
  data: MarketplaceFeatured;
}

export interface ContributorProfileResponse {
  success: boolean;
  data: ContributorProfile;
}

export interface RatingsListResponse {
  success: boolean;
  data: CommunityRating[];
  meta: { hasNext: boolean; nextCursor: string | null };
  aggregate: RatingAggregate;
}

export interface MyRatingResponse {
  success: boolean;
  data: CommunityRating | null;
}

export interface UpsertRatingResponse {
  success: boolean;
  data: CommunityRating;
}

export interface VoteResponse {
  success: boolean;
  data: CommunityVote;
}

export interface MyVoteResponse {
  success: boolean;
  data: CommunityVote | null;
}

export interface ExpertVerificationResponse {
  success: boolean;
  data: ExpertVerification;
}

export interface MyExpertVerificationResponse {
  success: boolean;
  data: ExpertVerification | null;
}

// ─── Input DTOs ─────────────────────────────────────────────────────────

export interface CreateRatingInput {
  entityType: CommunityEntityType;
  entityId: string;
  score: number;
  reviewTitle?: string;
  reviewBody?: string;
}

export interface CreateFlagInput {
  entityType: FlagEntityType;
  entityId: string;
  reason: FlagReason;
  details?: string;
}

export interface SubmitExpertVerificationInput {
  expertiseType: ExpertiseType;
  credentialDetails?: string;
}
