/**
 * Public bar-exam API contract (mobile mirror of apps/web/src/features/bar-exams/types.ts).
 *
 * The apiClient strips the `{ success, data }` envelope at the transport layer,
 * so every shape below is the *inner* payload — never wrap it again in callers.
 */

export interface BarExamSubjectSummary {
  sittingId: string;
  code: string | null;
  adminCode: string | null;
  part: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  questionCount: number;
}

export interface BarExamYearGroup {
  year: number;
  subjects: BarExamSubjectSummary[];
}

export interface BarExamSitting {
  id: string;
  year: number;
  part: string | null;
  subjectBarAdminCode: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  sourceDocumentId: string | null;
  questionCount: number;
}

export interface BarExamQuestion {
  id: string;
  number: number;
  text: string;
  subPartsCount: number;
  sourceSectionAnchor: string | null;
}

export interface BarExamSittingDetail {
  sitting: BarExamSitting;
  questions: BarExamQuestion[];
}

export interface BarExamAnswerStructured {
  answer: string;
  law: string;
  analysis: string;
  conclusion: string;
}

export interface BarExamAnswer {
  id: string;
  answerText: string;
  structuredAnswerJson: BarExamAnswerStructured | null;
  modelRun: {
    modelName: string;
    promptTemplateVersion: string | null;
  } | null;
  reviewedAt: string | null;
  question: {
    id: string;
    questionNumber: number;
    sittingId: string;
  };
}
