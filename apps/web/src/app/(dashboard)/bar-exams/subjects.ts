const STUDY_8_LABELS: Record<string, string> = {
  political_law: 'Political Law and International Law',
  labor_law: 'Labor Law and Social Legislation',
  civil_law: 'Civil Law',
  taxation: 'Taxation Law',
  mercantile_law: 'Mercantile Law',
  criminal_law: 'Criminal Law',
  remedial_law: 'Remedial Law',
  legal_ethics: 'Legal and Judicial Ethics',
};

export function subjectLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown subject';
  return STUDY_8_LABELS[code] ?? code.replace(/_/g, ' ');
}

export function subjectLabelWithPart(
  code: string | null | undefined,
  part: string | null | undefined,
): string {
  const base = subjectLabel(code);
  return part ? `${base} ${part}` : base;
}

export interface SubjectSummary {
  sittingId: string;
  code: string | null;
  adminCode: string | null;
  part: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  questionCount: number;
}

export interface YearGroup {
  year: number;
  subjects: SubjectSummary[];
}

export interface SittingDetail {
  sitting: {
    id: string;
    year: number;
    part: string | null;
    subjectStudyCode: string | null;
    subjectBarAdminCode: string | null;
    chairperson: string | null;
    sourceUrl: string | null;
    sourceDocumentId: string | null;
    questionCount: number;
  };
  questions: Array<{
    id: string;
    number: number;
    text: string;
    subPartsCount: number;
    sourceSectionAnchor: string | null;
  }>;
}
