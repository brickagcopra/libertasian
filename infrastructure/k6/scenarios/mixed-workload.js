// ==========================================================================
// LIBERTASIAN — k6 Scenario: Mixed Workload
// Realistic production traffic distribution:
//   40% search, 25% document reading, 15% suggestions/citations,
//   10% AI answers, 5% uploads, 5% auth
// ==========================================================================

import { sleep } from 'k6';
import { search, searchWithFilters } from './search.js';
import { readDocument, listSections, readSection } from './documents.js';
import { suggestions, citationLookup } from './public-endpoints.js';
import { aiAnswerSync, aiAnswerStream } from './ai-answers.js';
import { uploadPdf } from './uploads.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

/**
 * Search workload — 40% of traffic.
 * Mix of plain search and filtered search.
 */
export function searchWorkload(accessToken) {
  if (Math.random() < 0.7) {
    search(accessToken);
  } else {
    searchWithFilters(accessToken);
  }
}

/**
 * Document reader workload — 25% of traffic.
 * Simulates reading a document and its sections.
 */
export function documentWorkload() {
  const docId = readDocument();
  sleep(0.5);
  listSections(docId);
  sleep(0.5);
  readSection(docId);
  sleep(randomIntBetween(1, 3));
}

/**
 * Public suggestions/citation workload — 15% of traffic.
 * No auth needed.
 */
export function publicWorkload() {
  if (Math.random() < 0.6) {
    suggestions();
  } else {
    citationLookup();
  }
}

/**
 * AI answers workload — 10% of traffic.
 * Mix of sync and streaming.
 */
export function aiWorkload(accessToken) {
  if (Math.random() < 0.4) {
    aiAnswerSync(accessToken);
  } else {
    aiAnswerStream(accessToken);
  }
}

/**
 * Upload workload — 5% of traffic.
 */
export function uploadWorkload(accessToken) {
  uploadPdf(accessToken);
}

/**
 * Default function — weighted random selection across all workloads.
 * Expects data.accessToken from setup().
 */
export default function (data) {
  const accessToken = data && data.accessToken;

  const roll = Math.random();

  if (roll < 0.40) {
    // 40% — Search (requires auth)
    if (accessToken) {
      searchWorkload(accessToken);
    } else {
      publicWorkload(); // fallback to public if no auth
    }
  } else if (roll < 0.65) {
    // 25% — Document reading (public)
    documentWorkload();
  } else if (roll < 0.80) {
    // 15% — Suggestions / citations (public)
    publicWorkload();
  } else if (roll < 0.90) {
    // 10% — AI answers (requires auth)
    if (accessToken) {
      aiWorkload(accessToken);
    } else {
      publicWorkload();
    }
  } else if (roll < 0.95) {
    // 5% — File uploads (requires auth)
    if (accessToken) {
      uploadWorkload(accessToken);
    } else {
      documentWorkload();
    }
  } else {
    // 5% — Auth flow (login is tested separately, here just read documents)
    documentWorkload();
  }
}
