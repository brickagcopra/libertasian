// ==========================================================================
// LIBERTASIAN — k6 Load Test Profile
// Purpose: Sustained load — verify SLOs hold under expected peak traffic
// Pattern: Ramp 0→20 VUs (1min) → hold 20 (2min) → ramp to 50 (1min) → hold 50 (1min)
// Total duration: ~5 minutes
// ==========================================================================

import { sleep } from 'k6';
import { mergeThresholds } from '../lib/config.js';
import { authenticateTestUser } from '../lib/auth.js';
import { search, searchWithFilters } from '../scenarios/search.js';
import { readDocument, listSections, readSection } from '../scenarios/documents.js';
import { suggestions, citationLookup } from '../scenarios/public-endpoints.js';
import { aiAnswerSync, aiAnswerStream } from '../scenarios/ai-answers.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

export const options = {
  scenarios: {
    // Primary: mixed workload with ramping VUs
    mixed_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },  // Warm up to 20 VUs
        { duration: '2m', target: 20 },  // Hold at 20 VUs
        { duration: '1m', target: 50 },  // Ramp to peak
        { duration: '1m', target: 50 },  // Hold at peak
      ],
      exec: 'mixedLoad',
      gracefulRampDown: '10s',
    },
    // Secondary: public endpoints only (unauthenticated traffic)
    public_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 },
        { duration: '3m', target: 10 },
        { duration: '1m', target: 10 },
      ],
      exec: 'publicLoad',
      gracefulRampDown: '10s',
    },
  },
  thresholds: mergeThresholds(
    'search',
    'documentRead',
    'aiAnswer',
    'publicEndpoints',
  ),
};

export function setup() {
  const auth = authenticateTestUser();
  if (!auth) {
    console.error('Setup failed: could not authenticate test user');
  }
  return auth;
}

export function mixedLoad(data) {
  if (!data || !data.accessToken) {
    sleep(5);
    return;
  }

  const roll = Math.random();

  if (roll < 0.45) {
    // 45% — Search
    if (Math.random() < 0.7) {
      search(data.accessToken);
    } else {
      searchWithFilters(data.accessToken);
    }
  } else if (roll < 0.70) {
    // 25% — Document reading
    const docId = readDocument();
    sleep(0.5);
    listSections(docId);
    sleep(0.5);
    readSection(docId);
    sleep(randomIntBetween(1, 2));
  } else if (roll < 0.85) {
    // 15% — AI answers
    if (Math.random() < 0.4) {
      aiAnswerSync(data.accessToken);
    } else {
      aiAnswerStream(data.accessToken);
    }
  } else {
    // 15% — Public endpoints
    if (Math.random() < 0.6) {
      suggestions();
    } else {
      citationLookup();
    }
    sleep(randomIntBetween(1, 2));
  }
}

export function publicLoad() {
  if (Math.random() < 0.5) {
    suggestions();
  } else {
    citationLookup();
  }
  sleep(randomIntBetween(1, 3));

  const docId = readDocument();
  sleep(0.5);
  listSections(docId);
  sleep(randomIntBetween(1, 2));
}
