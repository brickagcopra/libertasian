import {
  BookOpenIcon,
  BriefcaseIcon,
  GavelIcon,
  HelpCircleIcon,
  LandmarkIcon,
  LibraryBigIcon,
  ScaleIcon,
  ScrollTextIcon,
  FileTextIcon,
  FilePenIcon,
  FileCheckIcon,
  LayersIcon,
  ListTreeIcon,
  SquareStackIcon,
  MessageSquareQuoteIcon,
  BadgeCheckIcon,
  type LucideIcon,
} from 'lucide-react';

import type { DerivativeType } from './types';

export interface DerivativeTypeMeta {
  enum: DerivativeType;
  label: string;
  singularLabel: string;
  slug: string;
  description: string;
  icon: LucideIcon;
}

export const DERIVATIVE_TYPES: readonly DerivativeTypeMeta[] = [
  {
    enum: 'case_digest',
    label: 'Case Digests',
    singularLabel: 'Case Digest',
    slug: 'digests',
    description: 'Condensed Supreme Court rulings with facts, issues, ruling, and doctrine.',
    icon: ScrollTextIcon,
  },
  {
    enum: 'doctrine_extract',
    label: 'Doctrine Extracts',
    singularLabel: 'Doctrine Extract',
    slug: 'doctrines',
    description: 'Distilled legal doctrines pulled from authoritative decisions.',
    icon: BookOpenIcon,
  },
  {
    enum: 'mcq_question',
    label: 'MCQs',
    singularLabel: 'MCQ',
    slug: 'mcqs',
    description: 'Multiple-choice bar-style questions with rationales.',
    icon: HelpCircleIcon,
  },
  {
    enum: 'essay_prompt',
    label: 'Essay Prompts',
    singularLabel: 'Essay Prompt',
    slug: 'essays',
    description: 'Bar-style essay questions with model answers and rubrics.',
    icon: FilePenIcon,
  },
  {
    enum: 'subject_outline',
    label: 'Subject Outlines',
    singularLabel: 'Subject Outline',
    slug: 'outlines',
    description: 'Study outlines organised by bar subject and topic.',
    icon: ListTreeIcon,
  },
  {
    enum: 'flashcard',
    label: 'Flashcards',
    singularLabel: 'Flashcard',
    slug: 'flashcards',
    description: 'Front-back cards for spaced-repetition bar review.',
    icon: SquareStackIcon,
  },
  {
    enum: 'essay_model_answer',
    label: 'Essay Model Answers',
    singularLabel: 'Essay Model Answer',
    slug: 'essay-answers',
    description: 'Worked model answers for practice essays.',
    icon: FileTextIcon,
  },
  {
    enum: 'suggested_bar_answer',
    label: 'Suggested Bar Answers',
    singularLabel: 'Suggested Bar Answer',
    slug: 'bar-answers',
    description: 'Suggested answers to past bar questions.',
    icon: BadgeCheckIcon,
  },
  {
    enum: 'sample_pleading',
    label: 'Sample Pleadings',
    singularLabel: 'Sample Pleading',
    slug: 'pleadings',
    description: 'Example pleadings and motion forms.',
    icon: GavelIcon,
  },
  {
    enum: 'sample_contract',
    label: 'Sample Contracts',
    singularLabel: 'Sample Contract',
    slug: 'contracts',
    description: 'Example contracts and drafting templates.',
    icon: FileCheckIcon,
  },
  {
    enum: 'one_page_summary',
    label: 'One-Page Summaries',
    singularLabel: 'One-Page Summary',
    slug: 'summaries',
    description: 'Condensed one-page briefs of key materials.',
    icon: LayersIcon,
  },
] as const;

export interface SubjectMeta {
  code: string;
  name: string;
  slug: string;
  icon: LucideIcon;
}

export const SUBJECTS: readonly SubjectMeta[] = [
  {
    code: 'political_law',
    name: 'Political Law and Public International Law',
    slug: 'political-law',
    icon: LandmarkIcon,
  },
  {
    code: 'civil_law',
    name: 'Civil Law',
    slug: 'civil-law',
    icon: ScaleIcon,
  },
  {
    code: 'criminal_law',
    name: 'Criminal Law',
    slug: 'criminal-law',
    icon: GavelIcon,
  },
  {
    code: 'labor_law',
    name: 'Labor Law and Social Legislation',
    slug: 'labor-law',
    icon: BriefcaseIcon,
  },
  {
    code: 'mercantile_law',
    name: 'Mercantile (Commercial) Law',
    slug: 'mercantile-law',
    icon: LibraryBigIcon,
  },
  {
    code: 'taxation',
    name: 'Taxation',
    slug: 'taxation',
    icon: LayersIcon,
  },
  {
    code: 'remedial_law',
    name: 'Remedial Law',
    slug: 'remedial-law',
    icon: MessageSquareQuoteIcon,
  },
  {
    code: 'legal_ethics',
    name: 'Legal and Judicial Ethics',
    slug: 'legal-ethics',
    icon: BadgeCheckIcon,
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
