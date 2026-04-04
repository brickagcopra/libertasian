export enum DocumentType {
  SUPREME_COURT_DECISION = 'supreme_court_decision',
  COURT_OF_APPEALS_DECISION = 'court_of_appeals_decision',
  REPUBLIC_ACT = 'republic_act',
  EXECUTIVE_ORDER = 'executive_order',
  PRESIDENTIAL_DECREE = 'presidential_decree',
  ADMINISTRATIVE_ORDER = 'administrative_order',
  ADMINISTRATIVE_CIRCULAR = 'administrative_circular',
  RULES_OF_COURT = 'rules_of_court',
  CONSTITUTION = 'constitution',
  OTHER = 'other',
}

export enum DocumentStatus {
  DRAFT = 'draft',
  INGESTED = 'ingested',
  PROCESSING = 'processing',
  INDEXED = 'indexed',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
  QUARANTINED = 'quarantined',
}

export enum SourceType {
  SUPREME_COURT_ELIB = 'supreme_court_elib',
  OFFICIAL_GAZETTE = 'official_gazette',
  LAWPHIL = 'lawphil',
  CHAN_ROBLES = 'chan_robles',
  CONGRESS = 'congress',
  SENATE = 'senate',
  EDITORIAL = 'editorial',
  USER_UPLOAD = 'user_upload',
}

export enum SourceAuthority {
  OFFICIAL = 'official',
  SEMI_OFFICIAL = 'semi_official',
  EDITORIAL = 'editorial',
  PRIVATE = 'private',
}

export enum DigestStatus {
  GENERATING = 'generating',
  GENERATED = 'generated',
  NEEDS_HUMAN_REVIEW = 'needs_human_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
}

export enum PrivacyLevel {
  PRIVATE = 'private',
  ORGANIZATION = 'organization',
  EDITORIAL_CANDIDATE = 'editorial_candidate',
  PUBLIC_EDITORIAL = 'public_editorial',
}

export enum ReviewDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  NEEDS_REVISION = 'needs_revision',
}

export interface CitationRef {
  sourceDocumentId: string;
  sectionId?: string;
  pageStart?: number;
  pageEnd?: number;
  text: string;
}
