// ==========================================================================
// LIBERTASIAN — k6 Scenario: Auth Flow
// Tests: POST /auth/login, POST /auth/refresh
// SLO: login p95 < 1s, refresh p95 < 500ms
// CAUTION: Auth endpoints rate-limited to 10 req / 15 min per IP.
//          Use very low VU count (1-2 max).
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, TEST_USER } from '../lib/config.js';
import { checkStatus } from '../lib/checks.js';

/**
 * Test login flow — authenticates and then refreshes the token.
 * Low iteration rate to stay under rate limit.
 */
export default function () {
  // Step 1: Login
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'login' },
    },
  );

  const loginOk = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'login has tokens': (r) => {
      try {
        const body = r.json();
        return !!(body.data && body.data.tokens && body.data.tokens.accessToken);
      } catch {
        return false;
      }
    },
  });

  if (!loginOk) {
    console.warn(`Login failed: status=${loginRes.status}`);
    sleep(30); // Back off on failure
    return;
  }

  const tokens = loginRes.json().data.tokens;

  // Short pause between login and refresh
  sleep(2);

  // Step 2: Refresh token
  const refreshRes = http.post(
    `${BASE_URL}/auth/refresh`,
    JSON.stringify({ refreshToken: tokens.refreshToken }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'refresh' },
    },
  );

  check(refreshRes, {
    'refresh status 200': (r) => r.status === 200,
    'refresh has new tokens': (r) => {
      try {
        const body = r.json();
        return !!(body.data && body.data.tokens && body.data.tokens.accessToken);
      } catch {
        return false;
      }
    },
  });

  // Long sleep to stay well under rate limit (10 req / 15 min = ~90s between requests)
  sleep(100);
}
