/**
 * Past bar exam subject-slug registry — TypeScript port of
 * ``services/worker-service/src/tasks/bar_exam_subjects.py``. Kept in
 * sync by hand: any change to the Python registry MUST be mirrored
 * here, and vice versa. The two are vendored rather than shared via a
 * package because we only use the registry inside one NestJS module
 * and one Celery package, and a shared package would add build
 * complexity (codegen across language boundaries) that isn't worth
 * paying for two read-only files.
 *
 * Maps LawPhil URL slug → study/admin taxonomy codes plus a label.
 * Two distinct slug eras live side-by-side because LawPhil renamed
 * several files in 2022 when the bar exam was first split into
 * morning/afternoon parts (Civil Law I/II, Remedial Law I/II) under
 * Justice Caguioa's reform.
 *
 * Years 2019, 2020, and 2021 are intentionally absent — LawPhil's
 * index page does not list them. The 2020 bar was cancelled outright
 * due to COVID-19, and the 2021 cohort sat the November 2022
 * examinations (counted as 2022).
 */

export interface BarSubjectMeta {
  studyCode: string;
  adminCode: string;
  part: string | null;
  label: string;
}

export const SUBJECT_REGISTRY: Readonly<Record<string, BarSubjectMeta>> = {
  // Legacy slugs (2006-2018): single-paper subjects.
  ethicQ: {
    studyCode: 'legal_ethics',
    adminCode: 'remedial_ethics_practical',
    part: null,
    label: 'Legal Ethics and Practical Exercises',
  },
  // 2015-only alias: that year's ethics paper is named legalQ.html on
  // LawPhil instead of ethicQ.html. Same content classification.
  legalQ: {
    studyCode: 'legal_ethics',
    adminCode: 'remedial_ethics_practical',
    part: null,
    label: 'Legal Ethics and Practical Exercises',
  },
  remedialQ: {
    studyCode: 'remedial_law',
    adminCode: 'remedial_ethics_practical',
    part: null,
    label: 'Remedial Law',
  },
  criminalQ: {
    studyCode: 'criminal_law',
    adminCode: 'criminal',
    part: null,
    label: 'Criminal Law',
  },
  mercanQ: {
    studyCode: 'mercantile_law',
    adminCode: 'commercial_taxation',
    part: null,
    label: 'Mercantile Law',
  },
  civilQ: {
    studyCode: 'civil_law',
    adminCode: 'civil_land_titles',
    part: null,
    label: 'Civil Law',
  },
  taxQ: {
    studyCode: 'taxation',
    adminCode: 'commercial_taxation',
    part: null,
    label: 'Taxation Law',
  },
  laborQ: {
    studyCode: 'labor_law',
    adminCode: 'labor_social',
    part: null,
    label: 'Labor Law and Social Legislation',
  },
  poliQ: {
    studyCode: 'political_law',
    adminCode: 'political_pil',
    part: null,
    label: 'Political Law and International Law',
  },

  // 2022-format slugs (split papers, new naming).
  'remedial-I_Q': {
    studyCode: 'remedial_law',
    adminCode: 'remedial_ethics_practical',
    part: 'I',
    label: 'Remedial Law I',
  },
  'remedial-II_Q': {
    studyCode: 'remedial_law',
    adminCode: 'remedial_ethics_practical',
    part: 'II',
    label: 'Remedial Law II',
  },
  'civil-I_Q': {
    studyCode: 'civil_law',
    adminCode: 'civil_land_titles',
    part: 'I',
    label: 'Civil Law I',
  },
  'civil-II_Q': {
    studyCode: 'civil_law',
    adminCode: 'civil_land_titles',
    part: 'II',
    label: 'Civil Law II',
  },
  comlawQ: {
    studyCode: 'mercantile_law',
    adminCode: 'commercial_taxation',
    part: null,
    label: 'Commercial Law',
  },
};

const LEGACY_SLUGS_2006_2018: readonly string[] = [
  'ethicQ',
  'remedialQ',
  'criminalQ',
  'mercanQ',
  'civilQ',
  'taxQ',
  'laborQ',
  'poliQ',
];

// 2015 swapped ethicQ → legalQ — only that year. All other 2015 slugs match.
const YEAR_2015_SLUGS: readonly string[] = LEGACY_SLUGS_2006_2018.map((s) =>
  s === 'ethicQ' ? 'legalQ' : s,
);

const YEAR_2022_SLUGS: readonly string[] = [
  'remedial-I_Q',
  'remedial-II_Q',
  'civil-I_Q',
  'civil-II_Q',
  'criminalQ',
  'comlawQ',
  'poliQ',
  'laborQ',
];

const LEGACY_YEARS: readonly number[] = [
  2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2016, 2017, 2018,
];

function buildYearSlugIndex(): readonly (readonly [number, string])[] {
  const rows: [number, string][] = [];
  for (const year of LEGACY_YEARS) {
    for (const slug of LEGACY_SLUGS_2006_2018) {
      rows.push([year, slug]);
    }
  }
  for (const slug of YEAR_2015_SLUGS) {
    rows.push([2015, slug]);
  }
  for (const slug of YEAR_2022_SLUGS) {
    rows.push([2022, slug]);
  }
  return rows;
}

export const ALL_YEAR_SLUGS: readonly (readonly [number, string])[] =
  buildYearSlugIndex();

export const LAWPHIL_BAR_BASE_URL = 'https://lawphil.net/courts/bm/barQ';
export const TAXONOMY_VERSION = 'study_8';

export function archiveUrlFor(year: number, slug: string): string {
  return `${LAWPHIL_BAR_BASE_URL}/${year}/${slug}.html`;
}

export function getSubjectMeta(slug: string): BarSubjectMeta | null {
  return SUBJECT_REGISTRY[slug] ?? null;
}

/** Sorted distinct list of years that have at least one archived sitting. */
export function archivedYears(): readonly number[] {
  const seen = new Set<number>();
  for (const [year] of ALL_YEAR_SLUGS) {
    seen.add(year);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Years that fall within the archive's outer span but have no LawPhil
 * pages on record. As of 2026 these are 2019, 2020, 2021.
 */
export function absentYears(): readonly number[] {
  const archived = new Set(archivedYears());
  if (archived.size === 0) return [];
  const minYear = Math.min(...archived);
  const maxYear = Math.max(...archived);
  const gaps: number[] = [];
  for (let y = minYear; y <= maxYear; y += 1) {
    if (!archived.has(y)) gaps.push(y);
  }
  return gaps;
}

/**
 * Operator-facing reason string for {@link absentYears}. Hard-coded
 * because the answer is editorial, not derivable: 2020 was cancelled,
 * 2021 cohort sat in November 2022, 2019 simply never made it onto
 * LawPhil. Update when the archive itself updates.
 */
export const ABSENCE_REASON =
  '2020 cancelled (COVID-19); 2021 cohort sat in November 2022 ' +
  '(counted as 2022); 2019 not in LawPhil archive.';
