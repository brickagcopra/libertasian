// ==========================================================================
// LIBERTASIAN — k6 Scenario: Public Endpoints
// Tests: GET /search/suggestions, GET /search/citation/:citation
// SLO: p95 < 300ms
// ==========================================================================

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { checkSuccess, checkStatus } from '../lib/checks.js';
import { randomSuggestionPrefix, randomCitation, randomIntBetween } from '../lib/data-generators.js';

/**
 * Test search suggestions / autocomplete endpoint.
 * Public, no auth required.
 */
export function suggestions() {
  const prefix = randomSuggestionPrefix();
  const res = http.get(
    `${BASE_URL}/search/suggestions?q=${encodeURIComponent(prefix)}`,
    { tags: { name: 'suggestions' } },
  );

  checkStatus(res, 200, 'suggestions');
  sleep(randomIntBetween(1, 2));
}

/**
 * Test citation lookup endpoint.
 * Public, no auth required.
 */
export function citationLookup() {
  const citation = randomCitation();
  const res = http.get(
    `${BASE_URL}/search/citation/${encodeURIComponent(citation)}`,
    { tags: { name: 'citation_lookup' } },
  );

  // 200 if found, 404 if not — both are valid for perf measurement
  checkStatus(res, res.status === 404 ? 404 : 200, 'citation_lookup');
  sleep(randomIntBetween(1, 2));
}

/**
 * Default function — alternates between suggestions and citation lookup.
 */
export default function () {
  if (Math.random() < 0.6) {
    suggestions();
  } else {
    citationLookup();
  }
}
