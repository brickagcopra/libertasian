// ==========================================================================
// LIBERTASIAN — k6 Spike Test Profile
// Purpose: Simulate sudden traffic burst — test auto-scaling / recovery
// Pattern: 10 VUs (30s) → spike to 300 (30s) → hold 300 (1min) →
//          drop to 10 (30s) → recovery hold (1.5min)
// Total duration: ~4 minutes
// ==========================================================================

import { sleep } from 'k6';
import { authenticateTestUser } from '../lib/auth.js';
import { search } from '../scenarios/search.js';
import { readDocument, listSections, readSection } from '../scenarios/documents.js';
import { suggestions, citationLookup } from '../scenarios/public-endpoints.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 10 },   // Baseline
        { duration: '30s', target: 300 },  // Spike up
        { duration: '1m', target: 300 },   // Hold at spike
        { duration: '30s', target: 10 },   // Drop back
        { duration: '1m30s', target: 10 }, // Recovery — verify system stabilizes
      ],
      exec: 'spikeWorkload',
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Spike test thresholds — focus on recovery, not peak performance
    // During spike: errors expected. After drop: should recover to normal SLOs.
    'http_req_duration{name:search}': ['p(95)<5000'],          // Very relaxed during spike
    'http_req_duration{name:document_read}': ['p(95)<3000'],
    'http_req_duration{name:suggestions}': ['p(95)<3000'],
    'http_req_duration{name:citation_lookup}': ['p(95)<3000'],
    http_req_failed: ['rate<0.25'],                             // Allow up to 25% during spike
  },
};

export function setup() {
  const auth = authenticateTestUser();
  if (!auth) {
    console.error('Setup failed: could not authenticate test user');
  }
  return auth;
}

export function spikeWorkload(data) {
  const accessToken = data && data.accessToken;
  const roll = Math.random();

  if (roll < 0.35) {
    // 35% — Search (authenticated if possible, else public fallback)
    if (accessToken) {
      search(accessToken);
    } else {
      suggestions();
      sleep(randomIntBetween(1, 2));
    }
  } else if (roll < 0.60) {
    // 25% — Document reading (public, scales well)
    const docId = readDocument();
    sleep(0.3);
    listSections(docId);
    sleep(randomIntBetween(1, 2));
  } else if (roll < 0.80) {
    // 20% — Suggestions (public, lightweight)
    suggestions();
    sleep(randomIntBetween(1, 2));
  } else {
    // 20% — Citation lookup (public, lightweight)
    citationLookup();
    sleep(randomIntBetween(1, 2));
  }
}
