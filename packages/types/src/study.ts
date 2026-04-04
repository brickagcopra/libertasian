/**
 * Study Mode types — shared across web, mobile, and API.
 * Phase 2: Codal reader, flashcards, reviewer packs, spaced repetition,
 * study sessions, and streaks.
 */

// ─── Bar Subjects ──────────────────────────────────────────────────────

export type BarSubjectCode =
  | 'civil_law'
  | 'commercial_law'
  | 'criminal_law'
  | 'labor_law'
  | 'political_law'
  | 'public_international_law'
  | 'remedial_law'
  | 'taxation_law'
  | 'legal_ethics';

export interface BarSubject {
  code: BarSubjectCode;
  name: string;
  documentCount: number;
}

// ─── Flashcard Sets ────────────────────────────────────────────────────

export type FlashcardVisibility = 'private' | 'org' | 'public_editorial';

export interface FlashcardSet {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  description: string | null;
  barSubject: BarSubjectCode | null;
  topic: string | null;
  visibility: FlashcardVisibility;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Flashcards ────────────────────────────────────────────────────────

export type FlashcardSourceType =
  | 'manual'
  | 'ai_generated'
  | 'from_digest'
  | 'from_provision';

export interface Flashcard {
  id: string;
  flashcardSetId: string;
  front: string;
  back: string;
  sourceType: FlashcardSourceType;
  ordering: number;
  createdAt: string;
  legalDocument?: { id: string; title: string; documentType: string } | null;
  digest?: { id: string; title: string } | null;
  section?: { id: string; sectionType: string; sectionLabel: string | null } | null;
}

// ─── Flashcard Reviews (Spaced Repetition) ─────────────────────────────

export type FlashcardResponse = 'again' | 'hard' | 'good' | 'easy';

export interface FlashcardReview {
  id: string;
  flashcardId: string;
  userId: string;
  response: FlashcardResponse;
  confidence: number;
  interval: number;
  easeFactor: number;
  reviewedAt: string;
}

export interface FlashcardReviewStats {
  totalReviews: number;
  responseBreakdown: Record<string, number>;
  dueCount: number;
}

// ─── Reviewer Packs ────────────────────────────────────────────────────

export interface ReviewerPack {
  id: string;
  organizationId: string | null;
  creatorUserId: string;
  title: string;
  description: string | null;
  barSubject: BarSubjectCode | null;
  topic: string | null;
  visibility: FlashcardVisibility;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; fullName: string };
}

export type ReviewerPackItemType = 'legal_document' | 'digest' | 'section';

export interface ReviewerPackItem {
  id: string;
  reviewerPackId: string;
  itemType: ReviewerPackItemType;
  ordering: number;
  note: string | null;
  createdAt: string;
  legalDocument?: { id: string; title: string; documentType: string; court: string | null; grNo: string | null } | null;
  digest?: { id: string; title: string; digestType: string } | null;
  section?: { id: string; sectionType: string; sectionLabel: string | null } | null;
}

// ─── Study Progress ────────────────────────────────────────────────────

export type StudyProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface StudyProgress {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  status: StudyProgressStatus;
  progressPct: number;
  lastAccessedAt: string;
  completedAt: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Study Sessions ────────────────────────────────────────────────────

export type StudySessionEntityType =
  | 'flashcard_set'
  | 'reviewer_pack'
  | 'codal_subject'
  | 'digest';

export interface StudySession {
  id: string;
  userId: string;
  entityType: StudySessionEntityType;
  entityId: string;
  barSubject: BarSubjectCode | null;
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  itemsStudied: number;
  itemsCorrect: number;
}

// ─── Study Streak ──────────────────────────────────────────────────────

export interface StudyStreak {
  current: number;
  longest: number;
  totalStudyDays: number;
  lastStudyDate: string | null;
}

// ─── Study Stats ───────────────────────────────────────────────────────

export interface SubjectBreakdown {
  barSubject: BarSubjectCode | null;
  totalTimeSecs: number;
  sessionCount: number;
}

export interface StudyStats {
  streak: StudyStreak;
  totalSessions: number;
  totalStudyTimeSecs: number;
  subjectBreakdown: SubjectBreakdown[];
}

// ─── Syllabus Mode (Bar Topic Study Path) ─────────────────────────────

export interface BarSyllabus {
  id: string;
  barSubjectCode: BarSubjectCode;
  title: string;
  description: string | null;
  examYear: number | null;
  topicCount: number;
  ordering: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyllabusTopic {
  id: string;
  syllabusId: string;
  parentTopicId: string | null;
  slug: string;
  title: string;
  description: string | null;
  depth: number;
  ordering: number;
  createdAt: string;
  updatedAt: string;
  children?: SyllabusTopic[];
  resources?: SyllabusTopicResource[];
  parent?: { id: string; title: string; slug: string } | null;
  _count?: { resources: number; children: number };
}

export type SyllabusResourceType =
  | 'legal_document'
  | 'digest'
  | 'flashcard_set'
  | 'reviewer_pack'
  | 'codal_section';

export interface SyllabusTopicResource {
  id: string;
  topicId: string;
  resourceType: SyllabusResourceType;
  resourceId: string;
  title: string | null;
  note: string | null;
  ordering: number;
  createdAt: string;
}

export interface SyllabusWithTopics extends BarSyllabus {
  topics: SyllabusTopic[];
}

export interface SyllabusTopicProgress {
  status: string;
  progressPct: number;
}

export interface SyllabusProgressSummary {
  syllabusId: string;
  totalTopics: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;
  overallPct: number;
  topicProgress: Record<string, SyllabusTopicProgress>;
}

export interface BarExamReadinessSubject {
  barSubjectCode: string;
  title: string;
  totalTopics: number;
  completedTopics: number;
  pct: number;
}

export interface BarExamReadiness {
  overallPct: number;
  totalTopics: number;
  completedTopics: number;
  subjects: BarExamReadinessSubject[];
}

// ─── Codal List ────────────────────────────────────────────────────────

export interface CodalListItem {
  id: string;
  title: string;
  shortTitle: string | null;
  documentType: string;
  citationText: string | null;
  promulgationDate: string | null;
  isOfficial: boolean;
  sectionCount: number;
}

// ─── Export Study Sets ─────────────────────────────────────────────────

export type ExportFormat = 'pdf' | 'docx';

// ─── Cursor Pagination ─────────────────────────────────────────────────

export interface CursorListMeta {
  hasNext: boolean;
  nextCursor: string | null;
  limit: number;
}
