// ==========================================================================
// LIBERTASIAN — k6 Scenario: Search
// Tests: POST /search (authenticated, hybrid BM25+kNN)
// SLO: p95 < 500ms
// ==========================================================================

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { getAuthHeaders } from '../lib/auth.js';
import { checkSuccess, checkStatus } from '../lib/checks.js';
import { randomQuery, randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

const DOCUMENT_TYPES = ['decision', 'resolution', 'republic_act', 'administrative_order'];
const COURTS = ['supreme_court', 'court_of_appeals', 'sandiganbayan'];

/**
 * Execute a search query with random parameters.
 * Requires auth — pass accessToken from setup().
 */
export function search(accessToken) {
  const query = randomQuery();
  const payload = JSON.stringify({ query, limit: 20 });

  const res = http.post(
    `${BASE_URL}/search`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'search' },
    },
  );

  checkStatus(res, res.status === 429 ? 429 : 200, 'search');
  sleep(randomIntBetween(1, 3));
}

/**
 * Search with filters — document type + court.
 */
export function searchWithFilters(accessToken) {
  const query = randomQuery();
  const docType = DOCUMENT_TYPES[Math.floor(Math.random() * DOCUMENT_TYPES.length)];
  const court = COURTS[Math.floor(Math.random() * COURTS.length)];

  const payload = JSON.stringify({
    query,
    documentType: docType,
    court,
    limit: 10,
  });

  const res = http.post(
    `${BASE_URL}/search`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'search' },
    },
  );

  checkStatus(res, res.status === 429 ? 429 : 200, 'search_filtered');
  sleep(randomIntBetween(1, 2));
}

/**
 * Search with date range filter.
 */
export function searchWithDateRange(accessToken) {
  const query = randomQuery();
  const payload = JSON.stringify({
    query,
    dateFrom: '2020-01-01',
    dateTo: '2025-12-31',
    limit: 20,
  });

  const res = http.post(
    `${BASE_URL}/search`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'search' },
    },
  );

  checkStatus(res, res.status === 429 ? 429 : 200, 'search_date_range');
  sleep(randomIntBetween(1, 2));
}

/**
 * Default function — simulates varied search behavior.
 * Expects data.accessToken from setup().
 */
export default function (data) {
  if (!data || !data.accessToken) {
    console.warn('No auth data — skipping search iteration');
    sleep(5);
    return;
  }

  const roll = Math.random();
  if (roll < 0.6) {
    search(data.accessToken);
  } else if (roll < 0.85) {
    searchWithFilters(data.accessToken);
  } else {
    searchWithDateRange(data.accessToken);
  }
}
