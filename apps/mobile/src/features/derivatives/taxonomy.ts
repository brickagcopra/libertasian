import type { DerivativeType } from './types';

export type IoniconName =
  | 'document-text-outline'
  | 'book-outline'
  | 'help-circle-outline'
  | 'create-outline'
  | 'list-outline'
  | 'copy-outline'
  | 'document-outline'
  | 'ribbon-outline'
  | 'hammer-outline'
  | 'checkmark-done-outline'
  | 'layers-outline'
  | 'business-outline'
  | 'scale-outline'
  | 'briefcase-outline'
  | 'library-outline'
  | 'chatbubble-outline';

export interface DerivativeTypeMeta {
  enum: DerivativeType;
  label: string;
  slug: string;
  description: string;
  icon: IoniconName;
}

export const DERIVATIVE_TYPES: readonly DerivativeTypeMeta[] = [
  {
    enum: 'case_digest',
    label: 'Case Digests',
    slug: 'digests',
    description: 'Condensed Supreme Court rulings with facts, issues, ruling, and doctrine.',
    icon: 'document-text-outline',
  },
  {
    enum: 'doctrine_extract',
    label: 'Doctrine Extracts',
    slug: 'doctrines',
    description: 'Distilled legal doctrines pulled from authoritative decisions.',
    icon: 'book-outline',
  },
  {
    enum: 'mcq_question',
    label: 'MCQs',
    slug: 'mcqs',
    description: 'Multiple-choice bar-style questions with rationales.',
    icon: 'help-circle-outline',
  },
  {
    enum: 'essay_prompt',
    label: 'Essay Prompts',
    slug: 'essays',
    description: 'Bar-style essay questions with model answers and rubrics.',
    icon: 'create-outline',
  },
  {
    enum: 'subject_outline',
    label: 'Subject Outlines',
    slug: 'outlines',
    description: 'Study outlines organised by bar subject and topic.',
    icon: 'list-outline',
  },
  {
    enum: 'flashcard',
    label: 'Flashcards',
    slug: 'flashcards',
    description: 'Front-back cards for spaced-repetition bar review.',
    icon: 'copy-outline',
  },
  {
    enum: 'essay_model_answer',
    label: 'Essay Model Answers',
    slug: 'essay-answers',
    description: 'Worked model answers for practice essays.',
    icon: 'document-outline',
  },
  {
    enum: 'suggested_bar_answer',
    label: 'Suggested Bar Answers',
    slug: 'bar-answers',
    description: 'Suggested answers to past bar questions.',
    icon: 'ribbon-outline',
  },
  {
    enum: 'sample_pleading',
    label: 'Sample Pleadings',
    slug: 'pleadings',
    description: 'Example pleadings and motion forms.',
    icon: 'hammer-outline',
  },
  {
    enum: 'sample_contract',
    label: 'Sample Contracts',
    slug: 'contracts',
    description: 'Example contracts and drafting templates.',
    icon: 'checkmark-done-outline',
  },
  {
    enum: 'one_page_summary',
    label: 'One-Page Summaries',
    slug: 'summaries',
    description: 'Condensed one-page briefs of key materials.',
    icon: 'layers-outline',
  },
] as const;

export interface SubjectMeta {
  code: string;
  name: string;
  slug: string;
  icon: IoniconName;
}

export const SUBJECTS: readonly SubjectMeta[] = [
  {
    code: 'political_law',
    name: 'Political Law and Public International Law',
    slug: 'political-law',
    icon: 'business-outline',
  },
  { code: 'civil_law', name: 'Civil Law', slug: 'civil-law', icon: 'scale-outline' },
  {
    code: 'criminal_law',
    name: 'Criminal Law',
    slug: 'criminal-law',
    icon: 'hammer-outline',
  },
  {
    code: 'labor_law',
    name: 'Labor Law and Social Legislation',
    slug: 'labor-law',
    icon: 'briefcase-outline',
  },
  {
    code: 'mercantile_law',
    name: 'Mercantile (Commercial) Law',
    slug: 'mercantile-law',
    icon: 'library-outline',
  },
  { code: 'taxation', name: 'Taxation', slug: 'taxation', icon: 'layers-outline' },
  {
    code: 'remedial_law',
    name: 'Remedial Law',
    slug: 'remedial-law',
    icon: 'chatbubble-outline',
  },
  {
    code: 'legal_ethics',
    name: 'Legal and Judicial Ethics',
    slug: 'legal-ethics',
    icon: 'ribbon-outline',
  },
] as const;

export function typeFromSlug(slug: string): DerivativeTypeMeta | undefined {
  return DERIVATIVE_TYPES.find((t) => t.slug === slug);
}

export function typeFromEnum(value: string): DerivativeTypeMeta | undefined {
  return DERIVATIVE_TYPES.find((t) => t.enum === value);
}

export function subjectFromSlug(slug: string): SubjectMeta | undefined {
  return SUBJECTS.find((s) => s.slug === slug);
}

export function subjectFromCode(code: string): SubjectMeta | undefined {
  return SUBJECTS.find((s) => s.code === code);
}
