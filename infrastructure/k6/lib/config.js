// ==========================================================================
// LIBERTASIAN — k6 Configuration
// Centralized config: base URL, thresholds, env vars
// ==========================================================================

export const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3001/api/v1';

export const TEST_USER = {
  email: __ENV.K6_TEST_USER_EMAIL || 'k6-perf@libertasian.test',
  password: __ENV.K6_TEST_USER_PASSWORD || 'K6PerfTest2026!',
};

export const ADMIN_USER = {
  email: __ENV.K6_ADMIN_USER_EMAIL || 'k6-admin@libertasian.test',
  password: __ENV.K6_ADMIN_USER_PASSWORD || 'K6AdminTest2026!',
};

// Performance SLO thresholds
export const THRESHOLDS = {
  // Search: p95 < 500ms
  search: {
    'http_req_duration{name:search}': ['p(95)<500'],
  },

  // Document reader: p95 < 200ms
  documentRead: {
    'http_req_duration{name:document_read}': ['p(95)<200'],
    'http_req_duration{name:section_list}': ['p(95)<200'],
    'http_req_duration{name:section_read}': ['p(95)<200'],
  },

  // AI answer TTFT: p95 < 2s
  aiAnswer: {
    'http_req_duration{name:ai_answer_sync}': ['p(95)<15000'],
    'http_req_duration{name:ai_answer_stream}': ['p(95)<15000'],
    'ai_answer_ttft': ['p(95)<2000'],
  },

  // OCR pipeline: p95 < 30s
  ocrPipeline: {
    'http_req_duration{name:upload_file}': ['p(95)<5000'],
    'ocr_pipeline_duration': ['p(95)<30000'],
  },

  // Auth: p95 < 1s
  auth: {
    'http_req_duration{name:login}': ['p(95)<1000'],
    'http_req_duration{name:refresh}': ['p(95)<500'],
  },

  // Public endpoints: p95 < 300ms
  publicEndpoints: {
    'http_req_duration{name:suggestions}': ['p(95)<300'],
    'http_req_duration{name:citation_lookup}': ['p(95)<300'],
  },

  // Digests: p95 < 180s (3min RAG timeout)
  digests: {
    'http_req_duration{name:digest_generate}': ['p(95)<180000'],
  },

  // Global
  global: {
    http_req_failed: ['rate<0.05'], // <5% error rate
  },
};

// Merge selected threshold groups
export function mergeThresholds(...groups) {
  const merged = { ...THRESHOLDS.global };
  for (const group of groups) {
    const t = THRESHOLDS[group];
    if (t) Object.assign(merged, t);
  }
  return merged;
}

// JWT access token TTL (15 min) — refresh before expiry in soak tests
export const JWT_ACCESS_TTL_MS = 15 * 60 * 1000;
export const JWT_REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry
