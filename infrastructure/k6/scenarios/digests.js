// ==========================================================================
// LIBERTASIAN — k6 Scenario: Digest Generation
// Tests: POST /digests/generate, GET /digests/:id, GET /digests
// SLO: p95 < 180s (3min RAG timeout)
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { getAuthHeaders } from '../lib/auth.js';
import { checkStatus } from '../lib/checks.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

const DIGEST_TYPES = ['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'];

/**
 * Generate a digest from a legal document via RAG pipeline.
 * This is the heaviest endpoint — involves LLM inference.
 */
export function generateDigest(accessToken) {
  const docId = randomDocumentId();
  const digestType = DIGEST_TYPES[Math.floor(Math.random() * DIGEST_TYPES.length)];

  const payload = JSON.stringify({
    legalDocumentId: docId,
    digestType,
  });

  const res = http.post(
    `${BASE_URL}/digests/generate`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'digest_generate' },
      timeout: '180s', // 3-minute RAG timeout
    },
  );

  // 200/201 = success, 429 = quota, 404 = doc not found — all valid for perf
  check(res, {
    'digest_generate status ok': (r) =>
      r.status === 200 || r.status === 201 || r.status === 429 || r.status === 404,
    'digest_generate has data': (r) => {
      if (r.status === 429 || r.status === 404) return true; // expected non-success
      try {
        const body = r.json();
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(randomIntBetween(5, 10));
}

/**
 * List digests with cursor pagination.
 */
export function listDigests(accessToken) {
  const res = http.get(
    `${BASE_URL}/digests?limit=20`,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'digest_list' },
    },
  );

  checkStatus(res, res.status === 429 ? 429 : 200, 'digest_list');
  sleep(randomIntBetween(1, 2));
}

/**
 * Batch lookup digests by document IDs.
 */
export function batchDigestLookup(accessToken) {
  const docIds = [];
  const count = randomIntBetween(3, 8);
  for (let i = 0; i < count; i++) {
    docIds.push(randomDocumentId());
  }

  const payload = JSON.stringify({ legalDocumentIds: docIds });

  const res = http.post(
    `${BASE_URL}/digests/by-documents`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'digest_batch_lookup' },
    },
  );

  checkStatus(res, res.status === 429 ? 429 : 200, 'digest_batch_lookup');
  sleep(randomIntBetween(1, 2));
}

/**
 * Default function — weighted: 30% generate, 40% list, 30% batch lookup.
 * Expects data.accessToken from setup().
 */
export default function (data) {
  if (!data || !data.accessToken) {
    console.warn('No auth data — skipping digest iteration');
    sleep(5);
    return;
  }

  const roll = Math.random();
  if (roll < 0.3) {
    generateDigest(data.accessToken);
  } else if (roll < 0.7) {
    listDigests(data.accessToken);
  } else {
    batchDigestLookup(data.accessToken);
  }
}
