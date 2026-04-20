export const DERIVATIVE_TYPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'essay_model_answer',
  'suggested_bar_answer',
  'flashcard',
  'subject_outline',
  'sample_pleading',
  'sample_contract',
  'one_page_summary',
] as const;

export type DerivativeType = (typeof DERIVATIVE_TYPES)[number];

export interface DerivativeSubjectSummary {
  code: string;
  name: string;
  taxonomyVersion: string;
  count: number;
}

export interface DerivativeListItem {
  id: string;
  title: string;
  derivativeType: DerivativeType;
  confidenceScore: number | null;
  createdAt: string;
  publishedAt: string | null;
  audience: string;
  language: string;
  sourceDocument: {
    id: string;
    title: string | null;
    shortTitle: string | null;
    citationText: string | null;
    court: string | null;
    decisionDate: string | null;
  } | null;
  subjects: Array<{
    code: string;
    name: string;
    taxonomyVersion: string;
    isPrimary: boolean;
  }>;
  disclaimer: { id: string; contentClass: string; version: number } | null;
  isGated: boolean;
  upgradeTier: string | null;
}

export interface DerivativeDetail extends DerivativeListItem {
  contentJson: unknown;
  contentPlainText: string | null;
  disclaimerBody: { bodyHtml: string; bodyPlain: string } | null;
  mcqQuestion: unknown | null;
  essayPrompt: unknown | null;
}

export interface DerivativesListResponse {
  success: boolean;
  data: DerivativeListItem[];
  meta: { hasNext: boolean; nextCursor?: string; limit: number };
}

export const DERIVATIVE_TYPE_LABELS: Record<DerivativeType, string> = {
  case_digest: 'Case Digest',
  doctrine_extract: 'Doctrine',
  mcq_question: 'MCQ',
  essay_prompt: 'Essay Prompt',
  essay_model_answer: 'Essay Answer',
  suggested_bar_answer: 'Bar Answer',
  flashcard: 'Flashcard',
  subject_outline: 'Outline',
  sample_pleading: 'Pleading',
  sample_contract: 'Contract',
  one_page_summary: 'Summary',
};
