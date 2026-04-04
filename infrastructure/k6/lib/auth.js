// ==========================================================================
// LIBERTASIAN — k6 Auth Helpers
// Login, refresh, and header utilities for authenticated scenarios
// ==========================================================================

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, TEST_USER, ADMIN_USER } from './config.js';

/**
 * Authenticate a user via POST /auth/login.
 * Call in setup() — runs once, tokens shared across all VUs.
 */
export function authenticateUser(email, password) {
  const url = `${BASE_URL}/auth/login`;
  const payload = JSON.stringify({ email, password });
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(url, payload, params);

  const success = check(res, {
    'login status 200': (r) => r.status === 200,
    'login has accessToken': (r) => {
      try {
        const body = r.json();
        return !!(body.data && body.data.tokens && body.data.tokens.accessToken);
      } catch {
        return false;
      }
    },
  });

  if (!success) {
    console.error(`Login failed for ${email}: status=${res.status} body=${res.body}`);
    return null;
  }

  const body = res.json();
  return {
    accessToken: body.data.tokens.accessToken,
    refreshToken: body.data.tokens.refreshToken,
    user: body.data.user,
    authenticatedAt: Date.now(),
  };
}

/**
 * Authenticate the default test user. Use in setup().
 */
export function authenticateTestUser() {
  return authenticateUser(TEST_USER.email, TEST_USER.password);
}

/**
 * Authenticate the admin test user. Use in setup().
 */
export function authenticateAdminUser() {
  return authenticateUser(ADMIN_USER.email, ADMIN_USER.password);
}

/**
 * Refresh an expired access token.
 * Returns updated auth data or null on failure.
 */
export function refreshAccessToken(refreshToken) {
  const url = `${BASE_URL}/auth/refresh`;
  const payload = JSON.stringify({ refreshToken });
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(url, payload, params);

  if (res.status !== 200) {
    console.error(`Token refresh failed: status=${res.status}`);
    return null;
  }

  const body = res.json();
  return {
    accessToken: body.data.tokens.accessToken,
    refreshToken: body.data.tokens.refreshToken,
    authenticatedAt: Date.now(),
  };
}

/**
 * Get Authorization headers for authenticated requests.
 */
export function getAuthHeaders(accessToken) {
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Get multipart-compatible auth headers (no Content-Type — let k6 set boundary).
 */
export function getMultipartAuthHeaders(accessToken) {
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };
}
