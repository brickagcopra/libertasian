// ==========================================================================
// LIBERTASIAN — k6 Scenario: Document Reader
// Tests: GET /documents/:id, /documents/:id/sections, /documents/:id/sections/:sectionId
// SLO: p95 < 200ms for all endpoints
// ==========================================================================

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { checkSuccess, checkStatus, checkDataObject, checkDataArray } from '../lib/checks.js';
import { randomDocumentId, randomSectionId, randomIntBetween } from '../lib/data-generators.js';

/**
 * Read a single legal document by ID.
 * Public endpoint — no auth required.
 */
export function readDocument() {
  const docId = randomDocumentId();
  const res = http.get(
    `${BASE_URL}/documents/${docId}`,
    { tags: { name: 'document_read' } },
  );

  // 200 if found, 404 if seeded data missing — both valid for perf
  checkStatus(res, res.status === 404 ? 404 : 200, 'document_read');
  return docId;
}

/**
 * List sections of a document.
 * Public endpoint — no auth required.
 */
export function listSections(docId) {
  const res = http.get(
    `${BASE_URL}/documents/${docId}/sections`,
    { tags: { name: 'section_list' } },
  );

  checkStatus(res, res.status === 404 ? 404 : 200, 'section_list');
}

/**
 * Read a specific section of a document.
 * Public endpoint — no auth required.
 */
export function readSection(docId) {
  const sectionId = randomSectionId();
  const res = http.get(
    `${BASE_URL}/documents/${docId}/sections/${sectionId}`,
    { tags: { name: 'section_read' } },
  );

  checkStatus(res, res.status === 404 ? 404 : 200, 'section_read');
}

/**
 * Default function — simulates a user reading a document:
 * 1. Open document → 2. List sections → 3. Read a section
 */
export default function () {
  const docId = readDocument();
  sleep(0.5);

  listSections(docId);
  sleep(0.5);

  readSection(docId);
  sleep(randomIntBetween(1, 3));
}
