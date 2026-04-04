/**
 * Community & Marketplace web feature types.
 * Mirrors the shared types from @libertasian/types/community
 * with API response envelopes for the web client.
 */

import type {
  CommunityEntityType,
  CommunityRating,
  CommunityVote,
  ContributorProfile,
  ExpertiseType,
  ExpertVerification,
  ExpertVerificationStatus,
  FlagEntityType,
  FlagReason,
  MarketplaceContentType,
  MarketplaceFeatured,
  MarketplaceItem,
  MarketplaceSortBy,
  RatingAggregate,
  VoteType,
} from '@libertasian/types';

// Re-export shared types for convenience
export type {
  CommunityEntityType,
  CommunityRating,
  CommunityVote,
  ContributorProfile,
  ExpertiseType,
  ExpertVerification,
  ExpertVerificationStatus,
  FlagEntityType,
  FlagReason,
  MarketplaceContentType,
  MarketplaceFeatured,
  MarketplaceItem,
  MarketplaceSortBy,
  RatingAggregate,
  VoteType,
};

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
