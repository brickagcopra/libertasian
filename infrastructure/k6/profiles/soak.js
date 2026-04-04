// ==========================================================================
// LIBERTASIAN — k6 Soak Test Profile
// Purpose: Sustained moderate load over extended period — detect memory
//          leaks, connection pool exhaustion, token expiry issues
// Pattern: Ramp to 30 VUs (1min) → hold 30 VUs (28min) → ramp down (1min)
// Total duration: ~30 minutes
// Features: Automatic JWT token refresh before expiry
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { mergeThresholds, JWT_ACCESS_TTL_MS, JWT_REFRESH_BUFFER_MS, BASE_URL, TEST_USER } from '../lib/config.js';
import { authenticateTestUser, refreshAccessToken, getAuthHeaders } from '../lib/auth.js';
import { search, searchWithFilters } from '../scenarios/search.js';
import { readDocument, listSections, readSection } from '../scenarios/documents.js';
import { suggestions, citationLookup } from '../scenarios/public-endpoints.js';
import { aiAnswerSync, aiAnswerStream } from '../scenarios/ai-answers.js';
import { listDigests, batchDigestLookup } from '../scenarios/digests.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

// Token refresh threshold: refresh 2 minutes before expiry
const REFRESH_THRESHOLD_MS = JWT_ACCESS_TTL_MS - JWT_REFRESH_BUFFER_MS;

// Per-VU token state (managed via __VU global)
const vuTokenState = {};

export const options = {
  scenarios: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 30 },   // Warm up
        { duration: '28m', target: 30 },  // Sustained load
        { duration: '1m', target: 0 },    // Cool down
      ],
      exec: 'soakWorkload',
      gracefulRampDown: '15s',
    },
  },
  thresholds: mergeThresholds(
    'search',
    'documentRead',
    'aiAnswer',
    'publicEndpoints',
    'auth',
  ),
};

export function setup() {
  const auth = authenticateTestUser();
  if (!auth) {
    console.error('Setup failed: could not authenticate test user');
  }
  return auth;
}

/**
 * Get a valid access token for the current VU.
 * Refreshes the token if it's within the refresh threshold.
 * Each VU maintains its own token lifecycle.
 */
function getValidToken(data) {
  const vuId = __VU;

  // Initialize VU token state from setup data
  if (!vuTokenState[vuId]) {
    vuTokenState[vuId] = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      authenticatedAt: data.authenticatedAt,
    };
  }

  const state = vuTokenState[vuId];
  const elapsed = Date.now() - state.authenticatedAt;

  // Refresh if approaching expiry
  if (elapsed >= REFRESH_THRESHOLD_MS) {
    const refreshed = refreshAccessToken(state.refreshToken);
    if (refreshed) {
      state.accessToken = refreshed.accessToken;
      state.refreshToken = refreshed.refreshToken;
      state.authenticatedAt = refreshed.authenticatedAt;
    } else {
      // Refresh failed — re-authenticate from scratch
      const reAuth = authenticateTestUser();
      if (reAuth) {
        state.accessToken = reAuth.accessToken;
        state.refreshToken = reAuth.refreshToken;
        state.authenticatedAt = reAuth.authenticatedAt;
      } else {
        console.error(`VU ${vuId}: token refresh and re-auth both failed`);
        return null;
      }
    }
  }

  return state.accessToken;
}

export function soakWorkload(data) {
  if (!data) {
    sleep(5);
    return;
  }

  const accessToken = getValidToken(data);
  if (!accessToken) {
    sleep(10);
    return;
  }

  const roll = Math.random();

  if (roll < 0.40) {
    // 40% — Search (primary workload)
    if (Math.random() < 0.7) {
      search(accessToken);
    } else {
      searchWithFilters(accessToken);
    }
  } else if (roll < 0.65) {
    // 25% — Document reading
    const docId = readDocument();
    sleep(0.5);
    listSections(docId);
    sleep(0.5);
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
    // 10% — AI answers
    if (Math.random() < 0.5) {
      aiAnswerSync(accessToken);
    } else {
      aiAnswerStream(accessToken);
    }
  } else {
    // 10% — Digest reads
    if (Math.random() < 0.5) {
      listDigests(accessToken);
    } else {
      batchDigestLookup(accessToken);
    }
  }
}
