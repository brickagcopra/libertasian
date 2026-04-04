// ==========================================================================
// LIBERTASIAN — k6 Stress Test Profile
// Purpose: Push beyond expected load to find breaking points
// Pattern: Ramp 0→50 (2min) → 50→100 (2min) → 100→200 (2min) →
//          hold 200 (2min) → ramp down (2min)
// Total duration: ~10 minutes
// ==========================================================================

import { sleep } from 'k6';
import { mergeThresholds } from '../lib/config.js';
import { authenticateTestUser } from '../lib/auth.js';
import { search, searchWithFilters } from '../scenarios/search.js';
import { readDocument, listSections, readSection } from '../scenarios/documents.js';
import { suggestions, citationLookup } from '../scenarios/public-endpoints.js';
import { aiAnswerSync } from '../scenarios/ai-answers.js';
import { listDigests, batchDigestLookup } from '../scenarios/digests.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

export const options = {
  scenarios: {
    stress_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },   // Ramp to expected peak
        { duration: '2m', target: 100 },  // Push to 2x expected
        { duration: '2m', target: 200 },  // Push to 4x expected
        { duration: '2m', target: 200 },  // Hold at max stress
        { duration: '2m', target: 0 },    // Ramp down — verify recovery
      ],
      exec: 'stressWorkload',
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    // Relaxed thresholds for stress test — we expect degradation
    // Goal: find the breaking point, not pass SLOs
    'http_req_duration{name:search}': ['p(95)<2000'],           // 4x normal
    'http_req_duration{name:document_read}': ['p(95)<1000'],    // 5x normal
    'http_req_duration{name:section_list}': ['p(95)<1000'],
    'http_req_duration{name:section_read}': ['p(95)<1000'],
    'http_req_duration{name:suggestions}': ['p(95)<1500'],      // 5x normal
    'http_req_duration{name:citation_lookup}': ['p(95)<1500'],
    'http_req_duration{name:ai_answer_sync}': ['p(95)<30000'],  // 2x normal
    http_req_failed: ['rate<0.15'],                              // Allow up to 15% errors
  },
};

export function setup() {
  const auth = authenticateTestUser();
  if (!auth) {
    console.error('Setup failed: could not authenticate test user');
  }
  return auth;
}

export function stressWorkload(data) {
  if (!data || !data.accessToken) {
    sleep(5);
    return;
  }

  const roll = Math.random();

  if (roll < 0.40) {
    // 40% — Search (highest volume in production)
    search(data.accessToken);
  } else if (roll < 0.65) {
    // 25% — Document reading (public, no auth needed)
    const docId = readDocument();
    sleep(0.3);
    listSections(docId);
    sleep(0.3);
    readSection(docId);
    sleep(randomIntBetween(1, 2));
  } else if (roll < 0.80) {
    // 15% — Public endpoints
    if (Math.random() < 0.6) {
      suggestions();
    } else {
      citationLookup();
    }
    sleep(randomIntBetween(1, 2));
  } else if (roll < 0.90) {
    // 10% — AI answers (heavy, sync only for stress)
    aiAnswerSync(data.accessToken);
  } else {
    // 10% — Digest list/batch (read-only, no generation under stress)
    if (Math.random() < 0.5) {
      listDigests(data.accessToken);
    } else {
      batchDigestLookup(data.accessToken);
    }
  }
}
