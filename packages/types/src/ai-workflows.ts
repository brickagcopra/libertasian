// =====================================================================
// AI Workflows Types — Phase 6
// =====================================================================

import type { CitationRef } from './legal';

// -----------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------

export enum MemoType {
  LEGAL_OPINION = 'legal_opinion',
  CASE_ANALYSIS = 'case_analysis',
  STATUTORY_ANALYSIS = 'statutory_analysis',
  COMPARATIVE = 'comparative',
  RESEARCH_SUMMARY = 'research_summary',
}

export enum MemoStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum PleadingCategory {
  MOTION = 'motion',
  COMPLAINT = 'complaint',
  PETITION = 'petition',
  ANSWER = 'answer',
  MEMORANDUM = 'memorandum',
  APPEAL = 'appeal',
  OTHER = 'other',
}

export enum ComparisonType {
  FULL = 'full',
  DOCTRINE_ONLY = 'doctrine_only',
  FACTS_ONLY = 'facts_only',
  RULING_ONLY = 'ruling_only',
}

export enum ContradictionScope {
  SELECTED = 'selected',
  TOPIC_BASED = 'topic_based',
}

export enum ContradictionSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// -----------------------------------------------------------------------
// Memo Drafting
// -----------------------------------------------------------------------

export interface MemoSection {
  heading: string;
  content: string;
  citations: CitationRef[];
}

export interface MemoStructuredOutput {
  title: string;
  summary: string;
  sections: MemoSection[];
  conclusion: string;
}

export interface MemoListItem {
  id: string;
  query: string;
  memoType: string;
  status: string;
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
}

export interface MemoDetail extends MemoListItem {
  structuredOutput: MemoStructuredOutput | null;
  citationsJson: CitationRef[];
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Pleading Assistance
// -----------------------------------------------------------------------

export interface PleadingTemplateSection {
  key: string;
  label: string;
  description: string;
  required: boolean;
  inputType: 'text' | 'textarea' | 'select' | 'date' | 'party_list';
  options?: string[];
}

export interface PleadingTemplateJson {
  sections: PleadingTemplateSection[];
  outputFormat: string;
}

export interface PleadingTemplateListItem {
  id: string;
  name: string;
  slug: string;
  category: string;
  court: string | null;
  description: string | null;
  isActive: boolean;
}

export interface PleadingListItem {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
  template: { id: string; name: string; category: string };
}

export interface PleadingDetail extends PleadingListItem {
  inputData: Record<string, unknown>;
  generatedOutput: Record<string, unknown> | null;
  citationsJson: CitationRef[];
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Case Comparison
// -----------------------------------------------------------------------

export interface ComparisonDocumentSummary {
  documentId: string;
  title: string;
  citationText: string | null;
  court: string | null;
  decisionDate: string | null;
}

export interface ComparisonDimension {
  dimension: string;
  entries: {
    documentId: string;
    content: string;
    citations: CitationRef[];
  }[];
  analysis: string;
}

export interface ComparisonResult {
  documents: ComparisonDocumentSummary[];
  dimensions: ComparisonDimension[];
  overallAnalysis: string;
}

export interface CaseComparisonListItem {
  id: string;
  documentIds: string[];
  comparisonType: string;
  status: string;
  createdAt: string;
  matterId: string | null;
}

export interface CaseComparisonDetail extends CaseComparisonListItem {
  resultJson: ComparisonResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Timeline Generation
// -----------------------------------------------------------------------

export interface TimelineEvent {
  date: string;
  label: string;
  description: string;
  sourceDocumentId: string | null;
  sourceSectionId: string | null;
  eventType: 'filing' | 'decision' | 'legislation' | 'amendment' | 'enforcement' | 'other';
}

export interface TimelineResult {
  events: TimelineEvent[];
  summary: string;
}

export interface CaseTimelineListItem {
  id: string;
  title: string;
  documentIds: string[];
  status: string;
  createdAt: string;
  matterId: string | null;
}

export interface CaseTimelineDetail extends CaseTimelineListItem {
  timelineJson: TimelineResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Hearing Prep
// -----------------------------------------------------------------------

export interface HearingPrepCase {
  documentId: string;
  title: string;
  citationText: string | null;
  relevance: string;
  keyHoldings: string[];
}

export interface HearingPrepProvision {
  documentId: string;
  sectionId: string | null;
  title: string;
  sectionLabel: string | null;
  text: string;
  relevance: string;
}

export interface HearingPrepArgument {
  position: string;
  supportingCases: string[];
  supportingProvisions: string[];
  strength: 'strong' | 'moderate' | 'weak';
}

export interface HearingPrepPackResult {
  cases: HearingPrepCase[];
  provisions: HearingPrepProvision[];
  arguments: HearingPrepArgument[];
  counterArguments: HearingPrepArgument[];
  suggestedQuestions: string[];
}

export interface HearingPrepListItem {
  id: string;
  topic: string;
  issue: string | null;
  status: string;
  createdAt: string;
  matterId: string | null;
}

export interface HearingPrepDetail extends HearingPrepListItem {
  documentIds: string[];
  inputContext: Record<string, unknown> | null;
  packJson: HearingPrepPackResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Contradiction Detection
// -----------------------------------------------------------------------

export interface ContradictionItem {
  documentAId: string;
  documentATitle: string;
  documentAPassage: string;
  documentBId: string;
  documentBTitle: string;
  documentBPassage: string;
  description: string;
  severity: ContradictionSeverity;
  doctrineArea: string | null;
}

export interface ContradictionReportResult {
  contradictions: ContradictionItem[];
  summary: string;
  documentsAnalyzed: number;
}

export interface ContradictionReportListItem {
  id: string;
  documentIds: string[];
  scope: string;
  topic: string | null;
  status: string;
  createdAt: string;
}

export interface ContradictionReportDetail extends ContradictionReportListItem {
  resultJson: ContradictionReportResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// -----------------------------------------------------------------------
// Research Workspaces
// -----------------------------------------------------------------------

export interface ResearchContextJson {
  pinnedDocumentIds: string[];
  pinnedSectionIds: string[];
  notes: string;
}

export interface ResearchQueryResponse {
  answer: string;
  citations: CitationRef[];
  followUpSuggestions: string[];
}

export interface ResearchWorkspaceListItem {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  queryCount: number;
}

export interface ResearchWorkspaceDetail extends ResearchWorkspaceListItem {
  contextJson: ResearchContextJson;
  userId: string;
  organizationId: string;
}

export interface ResearchQueryListItem {
  id: string;
  query: string;
  responseJson: ResearchQueryResponse | null;
  citationsJson: CitationRef[];
  createdAt: string;
}

// -----------------------------------------------------------------------
// Enterprise API Keys
// -----------------------------------------------------------------------

export enum ApiKeyPermission {
  SEARCH = 'search',
  DOCUMENTS_READ = 'documents:read',
  DIGESTS_READ = 'digests:read',
  MEMOS_GENERATE = 'memos:generate',
  MEMOS_READ = 'memos:read',
  COMPARISONS_GENERATE = 'comparisons:generate',
  COMPARISONS_READ = 'comparisons:read',
}

export const ALL_API_KEY_PERMISSIONS = Object.values(ApiKeyPermission);

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyDetail extends ApiKeyListItem {
  userId: string;
  organizationId: string;
  updatedAt: string;
}

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  keyPrefix: string;
  key: string; // Only returned on creation, never stored
}

// -----------------------------------------------------------------------
// External API Types
// -----------------------------------------------------------------------

export interface ExternalSearchResult {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  documentType: string;
  court: string | null;
  decisionDate: string | null;
  snippet: string;
  score: number;
}

export interface ExternalDocumentResult {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  documentType: string;
  court: string | null;
  decisionDate: string | null;
  ponente: string | null;
  status: string;
  sections: { id: string; sectionType: string; sectionLabel: string | null; plainText: string | null }[];
}
