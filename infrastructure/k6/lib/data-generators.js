// ==========================================================================
// LIBERTASIAN — k6 Test Data Generators
// SharedArray for memory-efficient data sharing across VUs
// ==========================================================================

import { SharedArray } from 'k6/data';

// Philippine legal search queries — realistic distribution across practice areas
export const LEGAL_QUERIES = new SharedArray('legalQueries', function () {
  return [
    // Constitutional Law
    'habeas corpus petition requirements',
    'equal protection clause Philippine jurisprudence',
    'right to due process administrative proceedings',
    'freedom of expression limitations',
    'writ of amparo enforced disappearance',
    'writ of habeas data privacy',
    'bill of rights unreasonable search seizure',
    'separation of powers executive privilege',

    // Criminal Law
    'qualified theft elements of the crime',
    'murder vs homicide treachery evident premeditation',
    'drug possession chain of custody requirements',
    'cybercrime prevention act RA 10175',
    'anti-money laundering act suspicious transactions',
    'bail hearing capital offense',
    'plea bargaining dangerous drugs',
    'probation law conditions',

    // Civil Law
    'breach of contract damages',
    'obligation and contracts rescission',
    'property law usufruct rights',
    'succession compulsory heirs legitime',
    'family code marriage annulment grounds',
    'adoption domestic requirements',
    'torts and damages quasi-delict',
    'specific performance real estate',

    // Labor Law
    'illegal dismissal just cause authorized cause',
    'labor code termination procedural requirements',
    'constructive dismissal hostile work environment',
    'overtime pay computation night shift differential',
    'regularization probationary employee six months',
    'unfair labor practice union busting',
    'separation pay computation formula',
    'DOLE department order flexible work',

    // Tax Law
    'income tax individual computation BIR',
    'value added tax VAT exemptions',
    'tax assessment prescription period',
    'estate tax amnesty Republic Act 11213',
    'documentary stamp tax real property',
    'withholding tax rates services',

    // Commercial Law
    'corporation code revised 2019 RA 11232',
    'partnership liability general limited',
    'insurance code subrogation',
    'negotiable instruments promissory note',
    'intellectual property trademark infringement',
    'banking law secrecy deposits',

    // Remedial Law
    'rules of court civil procedure',
    'certiorari grave abuse discretion',
    'appeal bond perfection period',
    'injunction preliminary mandatory',
    'small claims court procedure',
    'evidence hearsay exceptions',

    // Special Laws
    'Republic Act 10173 data privacy compliance',
    'anti-violence against women children RA 9262',
    'environmental compliance certificate requirements',
    'agrarian reform land acquisition distribution',
    'indigenous peoples rights act IPRA',
    'competition act Philippine antitrust',
  ];
});

// Seeded document IDs — must match seed-perf-data.sql
export const DOCUMENT_IDS = new SharedArray('documentIds', function () {
  return [
    'k6-doc-00000000-0000-0000-0000-000000000001',
    'k6-doc-00000000-0000-0000-0000-000000000002',
    'k6-doc-00000000-0000-0000-0000-000000000003',
    'k6-doc-00000000-0000-0000-0000-000000000004',
    'k6-doc-00000000-0000-0000-0000-000000000005',
    'k6-doc-00000000-0000-0000-0000-000000000006',
    'k6-doc-00000000-0000-0000-0000-000000000007',
    'k6-doc-00000000-0000-0000-0000-000000000008',
    'k6-doc-00000000-0000-0000-0000-000000000009',
    'k6-doc-00000000-0000-0000-0000-000000000010',
    'k6-doc-00000000-0000-0000-0000-000000000011',
    'k6-doc-00000000-0000-0000-0000-000000000012',
    'k6-doc-00000000-0000-0000-0000-000000000013',
    'k6-doc-00000000-0000-0000-0000-000000000014',
    'k6-doc-00000000-0000-0000-0000-000000000015',
    'k6-doc-00000000-0000-0000-0000-000000000016',
    'k6-doc-00000000-0000-0000-0000-000000000017',
    'k6-doc-00000000-0000-0000-0000-000000000018',
    'k6-doc-00000000-0000-0000-0000-000000000019',
    'k6-doc-00000000-0000-0000-0000-000000000020',
  ];
});

// Section IDs per document — must match seed-perf-data.sql
export const SECTION_IDS = new SharedArray('sectionIds', function () {
  return [
    'k6-sec-00000000-0000-0000-0000-000000000001',
    'k6-sec-00000000-0000-0000-0000-000000000002',
    'k6-sec-00000000-0000-0000-0000-000000000003',
    'k6-sec-00000000-0000-0000-0000-000000000004',
    'k6-sec-00000000-0000-0000-0000-000000000005',
  ];
});

// Citation patterns for citation lookup endpoint
export const CITATIONS = new SharedArray('citations', function () {
  return [
    'G.R. No. 100001',
    'G.R. No. 100002',
    'G.R. No. 100003',
    'G.R. No. 100004',
    'G.R. No. 100005',
    'G.R. No. 100006',
    'G.R. No. 100007',
    'G.R. No. 100008',
    'G.R. No. 100009',
    'G.R. No. 100010',
    'G.R. No. 200001',
    'G.R. No. 200002',
    'G.R. No. 200003',
    'G.R. No. 200004',
    'G.R. No. 200005',
  ];
});

// Autocomplete prefixes for suggestions endpoint
export const SUGGESTION_PREFIXES = new SharedArray('suggestionPrefixes', function () {
  return [
    'hab', 'cert', 'murd', 'theft', 'lab', 'term', 'div', 'ann',
    'tax', 'vat', 'corp', 'part', 'ins', 'ban', 'dat', 'priv',
    'env', 'agr', 'ipr', 'tra', 'con', 'due', 'bre', 'dam',
  ];
});

// Random selection helpers
export function randomQuery() {
  return LEGAL_QUERIES[Math.floor(Math.random() * LEGAL_QUERIES.length)];
}

export function randomDocumentId() {
  return DOCUMENT_IDS[Math.floor(Math.random() * DOCUMENT_IDS.length)];
}

export function randomSectionId() {
  return SECTION_IDS[Math.floor(Math.random() * SECTION_IDS.length)];
}

export function randomCitation() {
  return CITATIONS[Math.floor(Math.random() * CITATIONS.length)];
}

export function randomSuggestionPrefix() {
  return SUGGESTION_PREFIXES[Math.floor(Math.random() * SUGGESTION_PREFIXES.length)];
}

export function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
