// Bar Subject
export interface BarSubject {
  code: string;
  name: string;
  documentCount: number;
}

// Codal List Item (from /study/codals/:subject)
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

export interface CodalListMeta {
  hasNext: boolean;
  nextCursor: string | null;
  limit: number;
  subject: string;
}

// Flashcard Set
export interface FlashcardSet {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  description: string | null;
  barSubject: string | null;
  topic: string | null;
  visibility: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

// Flashcard
export interface Flashcard {
  id: string;
  flashcardSetId: string;
  front: string;
  back: string;
  sourceType: string;
  ordering: number;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    documentType: string;
  } | null;
  digest?: {
    id: string;
    title: string;
  } | null;
  section?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
}

// Reviewer Pack
export interface ReviewerPack {
  id: string;
  organizationId: string | null;
  creatorUserId: string;
  title: string;
  description: string | null;
  barSubject: string | null;
  topic: string | null;
  visibility: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  creator?: {
    id: string;
    fullName: string;
  };
}

// Reviewer Pack Item
export interface ReviewerPackItem {
  id: string;
  reviewerPackId: string;
  itemType: string;
  ordering: number;
  note: string | null;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    documentType: string;
    court: string | null;
    grNo: string | null;
  } | null;
  digest?: {
    id: string;
    title: string;
    digestType: string;
  } | null;
  section?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
}

// Syllabus Mode (Bar Topic Study Path)
export interface BarSyllabus {
  id: string;
  barSubjectCode: string;
  title: string;
  description: string | null;
  examYear: number | null;
  topicCount: number;
  ordering: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { topics: number };
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

export interface UpsertSyllabusTopicProgressInput {
  status: 'not_started' | 'in_progress' | 'completed';
  progressPct?: number;
}

// Study Progress
export interface StudyProgress {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  status: string;
  progressPct: number;
  lastAccessedAt: string;
  completedAt: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Export
export type ExportFormat = 'pdf' | 'docx';

// List meta (shared by flashcard sets and reviewer packs)
export interface CursorListMeta {
  hasNext: boolean;
  nextCursor: string | null;
  limit: number;
}

// Create/Update DTOs
export interface CreateFlashcardSetInput {
  title: string;
  description?: string;
  barSubject?: string;
  topic?: string;
  visibility?: 'private' | 'org' | 'public_editorial';
}

export interface UpdateFlashcardSetInput {
  title?: string;
  description?: string;
  barSubject?: string;
  topic?: string;
  visibility?: 'private' | 'org' | 'public_editorial';
}

export interface CreateFlashcardInput {
  front: string;
  back: string;
  legalDocumentId?: string;
  sectionId?: string;
  digestId?: string;
  sourceType?: 'manual' | 'ai_generated' | 'from_digest' | 'from_provision';
  ordering?: number;
}

export interface UpdateFlashcardInput {
  front?: string;
  back?: string;
  ordering?: number;
}

export interface CreateReviewerPackInput {
  title: string;
  description?: string;
  barSubject?: string;
  topic?: string;
  visibility?: 'private' | 'org' | 'public_editorial';
}

export interface UpdateReviewerPackInput {
  title?: string;
  description?: string;
  barSubject?: string;
  topic?: string;
  visibility?: 'private' | 'org' | 'public_editorial';
}

export interface AddReviewerPackItemInput {
  itemType: 'legal_document' | 'digest' | 'section';
  legalDocumentId?: string;
  digestId?: string;
  sectionId?: string;
  ordering?: number;
  note?: string;
}

export interface UpdateReviewerPackItemInput {
  ordering?: number;
  note?: string;
}

export interface UpsertStudyProgressInput {
  status: 'not_started' | 'in_progress' | 'completed';
  progressPct?: number;
  metadataJson?: Record<string, unknown>;
}

// Flashcard Review (Spaced Repetition)
export interface FlashcardReview {
  id: string;
  flashcardId: string;
  userId: string;
  response: 'again' | 'hard' | 'good' | 'easy';
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

export interface SubmitFlashcardReviewInput {
  response: 'again' | 'hard' | 'good' | 'easy';
  confidence?: number;
}

// Study Session
export interface StudySession {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  barSubject: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  itemsStudied: number;
  itemsCorrect: number;
}

export interface StartStudySessionInput {
  entityType: 'flashcard_set' | 'reviewer_pack' | 'codal_subject' | 'digest';
  entityId: string;
  barSubject?: string;
}

export interface EndStudySessionInput {
  itemsStudied?: number;
  itemsCorrect?: number;
}

// Study Stats & Streak
export interface StudyStreak {
  current: number;
  longest: number;
  totalStudyDays: number;
  lastStudyDate: string | null;
}

export interface SubjectBreakdown {
  barSubject: string | null;
  totalTimeSecs: number;
  sessionCount: number;
}

export interface StudyStats {
  streak: StudyStreak;
  totalSessions: number;
  totalStudyTimeSecs: number;
  subjectBreakdown: SubjectBreakdown[];
}
