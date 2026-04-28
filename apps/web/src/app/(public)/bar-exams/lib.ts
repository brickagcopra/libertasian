/**
 * Server-side helpers for the public bar-exams pages. These talk to the
 * NestJS API directly via fetch. The pages are server-rendered so the
 * client never sees a loading flash for a static archive.
 */

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

const API_URL =
  process.env['API_URL'] ||
  process.env['NEXT_PUBLIC_API_URL'] ||
  'http://localhost:3001/api/v1';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export function fetchAllYears(): Promise<YearGroup[] | null> {
  return getJson<YearGroup[]>('/bar-exams');
}

export function fetchYear(
  year: number,
): Promise<{ year: number; subjects: SubjectSummary[] } | null> {
  return getJson<{ year: number; subjects: SubjectSummary[] }>(
    `/bar-exams/${year}`,
  );
}

export function fetchSitting(
  year: number,
  subjectCode: string,
  part: string | null,
): Promise<SittingDetail | null> {
  const qs = part ? `?part=${encodeURIComponent(part)}` : '';
  return getJson<SittingDetail>(
    `/bar-exams/${year}/${encodeURIComponent(subjectCode)}${qs}`,
  );
}
