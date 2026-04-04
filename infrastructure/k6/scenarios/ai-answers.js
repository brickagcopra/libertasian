// ==========================================================================
// LIBERTASIAN — k6 Scenario: AI Answers (RAG)
// Tests: POST /ai-answers (sync), POST /ai-answers/stream (SSE)
// SLO: p95 TTFT < 2s, p95 total < 15s
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';
import { getAuthHeaders } from '../lib/auth.js';
import { checkStatus } from '../lib/checks.js';
import { randomQuery, randomIntBetween } from '../lib/data-generators.js';

// Custom metric: Time to First Token for SSE streams
const aiAnswerTtft = new Trend('ai_answer_ttft', true);

/**
 * Sync AI answer — POST /ai-answers.
 * Full round-trip: query → RAG retrieval → LLM generation → response.
 */
export function aiAnswerSync(accessToken) {
  const query = randomQuery();
  const payload = JSON.stringify({ query, maxPassages: 8 });

  const res = http.post(
    `${BASE_URL}/ai-answers`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'ai_answer_sync' },
      timeout: '60s',
    },
  );

  // 200 = answer, 429 = quota exceeded — both valid for perf
  checkStatus(res, res.status === 429 ? 429 : 200, 'ai_answer_sync');

  if (res.status === 200) {
    check(res, {
      'ai_answer has data': (r) => {
        try {
          const body = r.json();
          return body.success === true && body.data !== undefined;
        } catch {
          return false;
        }
      },
    });
  }

  sleep(randomIntBetween(3, 6));
}

/**
 * SSE streaming AI answer — POST /ai-answers/stream.
 * Measures Time to First Token (TTFT) via response timing.
 *
 * Note: k6 does not natively parse SSE event streams.
 * We measure TTFT as http_req_waiting (server processing time before
 * first byte), which closely approximates TTFT for chunked responses.
 */
export function aiAnswerStream(accessToken) {
  const query = randomQuery();
  const payload = JSON.stringify({ query, maxPassages: 8 });

  const startTime = Date.now();

  const res = http.post(
    `${BASE_URL}/ai-answers/stream`,
    payload,
    {
      ...getAuthHeaders(accessToken),
      tags: { name: 'ai_answer_stream' },
      timeout: '60s',
    },
  );

  const ttft = res.timings.waiting; // Time to first byte ≈ TTFT
  aiAnswerTtft.add(ttft);

  // 200 = streaming response, 429 = quota exceeded
  checkStatus(res, res.status === 429 ? 429 : 200, 'ai_answer_stream');

  if (res.status === 200) {
    check(res, {
      'stream response has content': (r) => r.body && r.body.length > 0,
      'stream TTFT under 2s': () => ttft < 2000,
    });
  }

  sleep(randomIntBetween(3, 6));
}

/**
 * Default function — alternates 40% sync, 60% streaming.
 * Expects data.accessToken from setup().
 */
export default function (data) {
  if (!data || !data.accessToken) {
    console.warn('No auth data — skipping AI answer iteration');
    sleep(5);
    return;
  }

  if (Math.random() < 0.4) {
    aiAnswerSync(data.accessToken);
  } else {
    aiAnswerStream(data.accessToken);
  }
}
