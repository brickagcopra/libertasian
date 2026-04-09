# LIBERTASIAN — Pending Tasks

> Last updated: 2026-04-09 (Session 191 — Subscription Lifecycle Event Processor)

---

## Session 191 — Subscription Lifecycle Event Processor — ALL COMPLETE

### Remaining for Production Billing Launch
- **Configure Xendit test mode API keys** in environment variables (`XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_CALLBACK_TOKEN`)
- **Run plan seed** on production database: `pnpm --filter api prisma db seed`
- **Test Xendit webhook** end-to-end with test payment methods
- **Configure Nginx** webhook route (should already be in place per commit 99ea0ae)
- **E2E test lifecycle processor** — Manually create lifecycle events with past `scheduledAt` and verify the cron picks them up and transitions subscriptions correctly

---

## Session 187-189 — Blog & Advertising Systems — ALL COMPLETE

### Completed (Sessions 187-189)
- [x] Phase 1: Database Schema (Prisma models + User relations)
- [x] Phase 2: NestJS Blog Module (DTOs, service, controllers, module)
- [x] Phase 3: NestJS Ads Module (DTOs, service, controllers, module)
- [x] Phase 4: Permissions Update (RBAC seed + role assignments)
- [x] Phase 5: Next.js Blog Frontend (types, hooks, pages, nav)
- [x] Phase 6: Next.js Ads Frontend (types, hooks, components, provider, admin pages)
- [x] Phase 7A: Mobile Blog (types, hooks, components, screens, SQLite caching)
- [x] Phase 7B: Mobile Ads (types, hooks, components, provider, renderer)
- [x] Phase 8A: Content Security (DOMPurify sanitization for blog HTML)
- [x] Phase 8B: CTA URL DTO validation (`@IsUrl({ require_protocol: true })` on create/update creative DTOs)
- [x] Prisma migration `20260409160959_add_blog_ads` applied (BlogPost, BlogTag, BlogPostTag, AdCampaign, AdCreative, AdEvent tables)
- [x] RBAC seed run (127 permissions, 417 role→permission mappings including blog:* and ads:*)
- [x] @tailwindcss/typography installed + configured via `@plugin` in globals.css (Tailwind v4)
- [x] Blog inline ad placements: `BlogInlineAd` component after 3rd/6th cards in listing, after content in detail page

---

## Session 186 — Email Templates, Preferences & Verification Code

### Pending
- **Run Prisma migration** when database is available: `pnpm --filter api prisma:migrate:dev` (migration `20260408200000_add_email_preferences` adds `email_verify_token_expires_at` to users + `email_preferences` table)
- **Install sanitize-html types** may need re-running if build fails: `pnpm --filter api add -D @types/sanitize-html`
- **Resend rate limiting**: Add Redis-based rate limiting for the `POST /auth/resend-verification` endpoint (max 3 resends per 15 min per email). Currently relies on the global throttle.
- **Backfill email preferences**: Existing users don't have `EmailPreference` rows. Run a one-time migration script or handle gracefully (the GET endpoint returns defaults if no row exists, and PATCH upserts).
- **End-to-end testing**: Test full verify-email OTP flow, email preferences toggle, admin announcement send, unsubscribe link

---

## Session 185 — Dynamic Homepage CMS

### Pending
- **Run Prisma migration** when database is available: `pnpm --filter api prisma:migrate:dev --name add-site-content`
- **End-to-end testing**: Verify homepage renders identically with no DB record, test admin save/reset flow

---

## Session 184 — TS Error Fixes (Ongoing)

### Completed This Session
- **search.service.spec.ts** — 25 errors fixed
- **simulator.service.spec.ts** — 21 errors fixed
- **analytics-aggregation.service.spec.ts** — 6 errors fixed

### Remaining Spec File TS Errors (from previous sessions)
- **coupon.service.spec.ts** — ~539 errors (in progress)
- **promotion.service.spec.ts** — ~384 errors
- **promotion-rule-engine.service.spec.ts** — ~209 errors
- **research-workspaces.service.spec.ts** — ~152 errors
- **pleadings.service.spec.ts** — ~129 errors
- **~35 other spec files** — ~987 errors total

---

## Session 183 — ✅ COMPLETE (VPS Deployment Guide)

**VPS_DEPLOYMENT_GUIDE.md** created at project root (~750 lines) covering:
- Architecture overview with 21-container topology diagram
- 7 deployment phases (VPS provisioning → OS hardening → Docker → DNS/SSL → env config → first deploy → monitoring)
- 6 appendices (Deployment.md mapping, hardening roadmap, K8s migration, disaster recovery, pre-launch checklist, env var reference)
- Inline configs for missing Alertmanager and Promtail configuration files
- Disaster recovery runbook with 7 scenarios and RTO/RPO estimates
- Complete environment variable reference (50+ vars with security classification)

---

## Phase 5: Performance & Load Testing (k6) — ✅ ALL COMPLETE (Sessions 180-182)

### Session 180 — ✅ COMPLETE (Infrastructure + Core Library + Smoke Tests)
All 12 tasks completed:
1. docker-compose.k6.yml (InfluxDB 1.8 + k6 runner service)
2. lib/config.js (BASE_URL, SLO thresholds, env vars, mergeThresholds helper)
3. lib/auth.js (authenticateUser, authenticateTestUser, refreshAccessToken, getAuthHeaders)
4. lib/checks.js (checkSuccess, checkStatus, checkDataArray, checkDataObject)
5. lib/data-generators.js (SharedArray: 56 PH legal queries, 20 doc IDs, 5 section IDs, 15 citations, 24 suggestion prefixes)
6. scenarios/public-endpoints.js (GET /search/suggestions + /search/citation/:citation)
7. scenarios/documents.js (GET /documents/:id + /sections + /sections/:id)
8. scenarios/auth-flow.js (POST /auth/login + /auth/refresh, rate-limit-safe)
9. profiles/smoke.js (2 VUs, 30s, public-endpoints + document-reader scenarios)
10. seed/seed-perf-data.sql (1 org, 2 users, 1 subscription, 1 source, 20 documents, 100 sections)
11. scripts/seed-test-data.sh (orchestrator: bcrypt hash gen → PostgreSQL seed → verify → OpenSearch index)
12. Updated Grafana datasources.yml with InfluxDB-k6 datasource

### Session 181 — ✅ COMPLETE (Core Scenarios + Load/Stress Profiles)
All 9 tasks completed:
1. scenarios/search.js (POST /search with auth, 3 variants: plain/filtered/date-range, p95 < 500ms)
2. scenarios/ai-answers.js (POST /ai-answers sync + POST /ai-answers/stream SSE, custom ai_answer_ttft Trend metric, p95 < 2s TTFT)
3. scenarios/uploads.js (POST /uploads multipart PDF/JPEG + GET /uploads/:id/status polling, custom ocr_pipeline_duration Trend metric, p95 < 30s)
4. scenarios/digests.js (POST /digests/generate + GET /digests + POST /digests/by-documents, 180s RAG timeout)
5. scenarios/mixed-workload.js (weighted: 40% search, 25% docs, 15% suggestions, 10% AI, 5% upload, 5% auth)
6. profiles/load.js (ramping-vus: 0→20→50 VUs over 5min, mixed authenticated + public scenarios)
7. profiles/stress.js (ramping-vus: 0→50→100→200→0 VUs over 10min, relaxed thresholds for breaking point discovery)
8. profiles/spike.js (ramping-vus: 10→300→10 VUs over 4min, recovery verification after spike)
9. profiles/soak.js (ramping-vus: 30 VUs sustained 30min, per-VU JWT token refresh with REFRESH_THRESHOLD_MS)

### Session 182 — ✅ COMPLETE (Dashboard + Runner Scripts)
All 4 tasks completed:
1. dashboards/k6-load-testing.json — Grafana dashboard (16 panels: VUs, req/s, error rate, P50/P95/P99 latency, per-endpoint latency, HTTP timing breakdown, status codes, AI TTFT, OCR pipeline duration, check pass rate, data transfer, iterations)
2. scripts/run-smoke.sh — Smoke test runner (2 VUs, 30s)
3. scripts/run-load.sh — Load test runner (0→20→50 VUs, 5min)
4. scripts/run-stress.sh — Stress test runner (0→50→100→200→0 VUs, 10min)

### Phase 5: Performance & Load Testing — ✅ ALL COMPLETE (Sessions 180-182)

---

## Analytics & User Behavior Monitoring System — ✅ ALL COMPLETE

### Session 172 — ✅ COMPLETE (Web Tracking + Dashboard UI)
All 8 tasks completed: tracking client, AnalyticsProvider, hooks, 4 dashboard pages, shared components, sidebar nav.

### Session 173 — ✅ COMPLETE (More Dashboard + Mobile Tracking)
All 6 tasks completed: Mobile & Scan page, Study Mode page, Corpus & Ingestion page, Real-time page, mobile tracking client with offline buffering, org-level analytics page, sidebar nav + hooks.

### Session 174 — ✅ COMPLETE (Integration & Testing)
All 5 tasks completed:
- Task 15: @TrackEvent decorators on 9 controllers (search, AI, digests, digests-admin, workspace, study, auth, billing, subscriptions)
- Task 16: AnalyticsService unit tests (38 tests — event validation, PII stripping, IP hashing, sessions, batching, taxonomy coverage, edge cases)
- Task 17: AnalyticsAggregationService unit tests (28 tests — engagement, search, AI, digest, scan, study, workspace, revenue, ingestion metrics, funnels, partitions, date handling)
- Task 18: AnalyticsDashboardService unit tests (15 tests — all dashboard endpoints, caching, date ranges, org filtering)
- Task 19: E2E tests (analytics.e2e-spec.ts — event tracking, session lifecycle, batch tracking, admin dashboard, user journey funnels, input validation)

---

## Code-Level Status: ALL PHASES COMPLETE (pre-analytics)

**Session 169 conducted a comprehensive codebase gap analysis confirming:**
- 40 NestJS modules fully implemented (including new Analytics module)
- 4 Python microservices (RAG, OCR, Embedding, Worker) operational
- 2,300+ API tests, 860 web tests, 928 mobile tests — all passing
- Phases 1-5 + Community Feed + Document Export + RBAC + Billing — all code-complete

---

## Blocked — Requires External Resources

### RAG Service Integrations
| Item | Blocker | Current State |
|------|---------|---------------|
| Embedding service (kNN) | Deploy embedding model + set `RAG_EMBEDDING_SERVICE_URL` | BM25-only retrieval works; kNN path coded but disabled |
| Cross-encoder reranker | Deploy reranker model + set `RAG_RERANKER_URL` | Fallback to RRF scores active; `core/reranking.py` ready |

### Infrastructure
| Item | Blocker | Current State |
|------|---------|---------------|
| Production VPS deployment | VPS provisioning (4-5 servers per PDD 10.1) | docker-compose.prod.yml, Nginx, monitoring, backup scripts, GH Actions all ready |
| OpenSearch index creation | Running OpenSearch instance | `opensearch.service.ts` auto-creates on module init |
| Edu plan billing launch | Xendit sandbox setup | Billing module + plan config ready |

### Phase 5+: Enterprise & Scale
| Item | Blocker |
|------|---------|
| Qdrant migration (from pgvector) | Corpus scale / vector query latency threshold |
| Multi-region deployment | Infrastructure budget |
| White-label / custom branding | Enterprise customer demand |

### Deferred Architectural Decisions (PRD Section 16 — Open Questions)
| Item | Decision Needed | Impact |
|------|----------------|--------|
| Bilateral/Taglish query support (SRCH-12, P2) | Native support vs. translation layer in RAG pipeline | Medium — not Phase 1 |
| On-device OCR preview | expo-ml-kit vs. pure server-side OCR | Low — server OCR fully working |
| Public API marketplace | Enterprise API access for third-party integrations | Low — Phase 6+ |
| AI-generated pleading templates | Legal risk assessment (unauthorized practice of law) | Medium — Phase 6+ |

---

## Completed Systems (Summary)

### Community Feed — ✅ COMPLETE (All 7 Phases, Sessions 162-164)
- Backend: 8 Prisma models, CRUD, media upload/processing pipeline, interactions, comments, reports, admin moderation
- Shared types: 7 enums, 8 interfaces in `packages/types/src/feed.ts`
- Web frontend: 7 hooks (infinite queries, optimistic updates), 9 components, 4 pages + sidebar navigation
- Mobile frontend: 6 hooks, 12 components, 7 screens, Feed tab in navigation
- E2E tests: 12 describe blocks, 40+ test cases (CRUD, visibility, cross-tenant isolation, ownership, comments, interactions, admin moderation, input validation, edge cases)
- **51 unit tests + 40+ E2E tests**

### Subscription, Coupons & Sales Promotions — ✅ COMPLETE (25 Sessions: 120-146)
- Plan model, feature flags, pricing engine, checkout, state machine, trials, pause/resume, upgrade/downgrade
- Coupon system (CRUD, validation, reservation, plan rules, user/org assignment)
- Promotion engine (modular rules, benefits, status lifecycle, plan eligibility)
- Central pricing engine, checkout price snapshots, proration
- Admin APIs: plans, coupons, promotions, subscriptions, simulator, reporting
- Web frontend: pricing page, checkout, billing settings, usage, admin panels (plans, coupons, promotions, subscriptions, simulator, reporting)
- Mobile: billing types, subscription/plans/usage screens, settings navigation
- **774+ billing tests, all passing**

### NIST RBAC User & Role Management — ✅ COMPLETE (7 Sessions: 113-119, 147)
- 6 Prisma models, ~90 permissions, 6 system roles, hierarchy DAG, SoD constraints
- PermissionsGuard + RequiredPermissions decorator, Redis caching, BFS hierarchy traversal
- 4 controllers (15 endpoints), 7 DTOs, dual-write migration
- Web UI: member management, role management, permission explorer, audit logs
- **111 RBAC tests across 7 suites, all passing**

### Phase 1 MVP — ✅ COMPLETE (Code-Level)
All 18 code-level items complete. Infrastructure-dependent items listed above.

### Phase 2 Study Mode — ✅ COMPLETE (Code-Level)
All items complete including offline sync. Edu plan billing needs Xendit.

### Phase 3 Mobile Camera Scan — ✅ COMPLETE (Code-Level)
All 12 items complete (camera UI, image processing, OCR, classifier, scan-to-digest/flashcards/outline, privacy controls, web+mobile UI).

### Phase 4 Practice Workspace — ✅ COMPLETE
All 13 items complete (matters, tasks, comments, memos, sharing, comparisons, pleadings, timelines, hearing prep, contradictions, research workspaces, notifications).

### Phase 4 Community & Marketplace — ✅ COMPLETE
Backend + web + mobile all complete (marketplace, ratings, curation, expert verification).

### Phase 5 Editorial Intelligence — ✅ COMPLETE (Code-Level)
All items complete (corpus gap analysis, analytics, case-codal linking, precedent trail, review queues).

### Ingestion Pipeline Enhancement — ✅ COMPLETE (Session 155)
5-tier dedup classifier, extended subject classification, classification/dedup review queues, reader tabs, ingestion pipeline dashboard, audit trails.

### Public Pages — ✅ COMPLETE
Landing, Terms, Privacy, footer — all complete.

### Dev Seed Script — ✅ COMPLETE
All 4 phases complete. Run: `pnpm --filter api seed && pnpm --filter api seed:dev`

### Test Coverage — ✅ COMPREHENSIVE (Session 175-177)
- **API:** 109 suites, 2464+ tests — all passing
  - Session 176: +2 E2E test files (rate-limiting.e2e-spec.ts, file-upload-security.e2e-spec.ts)
- **Web:** Vitest + RTL — 121 suites, 1,118 tests — all passing
  - Session 177: +22 test files (8 feed components, 5 feed hooks, 4 analytics components, 1 analytics hook, 2 export components, 1 export hook, 1 error page)
- **Mobile:** Jest + RNTL — 164 suites, 1,135 tests — all passing
  - Session 177: +6 test files (MMKV storage, API client auth/refresh, root layout nav guard, admin/community/workspace layout)
- **RAG Service:** 505+ tests — all passing
  - Session 176: +1 test file (test_routers.py — 30+ HTTP endpoint tests across all 12 routers)
- **Embedding Service:** 37+ tests — all passing
  - Session 176: +1 test file (test_embedding_correctness.py — 25+ cosine similarity, normalization, determinism tests)
- **OCR Service:** 186+ tests — all passing
  - Session 176: +1 test file (test_routers.py — 20+ HTTP endpoint tests across all 5 routers)
- **Worker Service:** 143+ tests — all passing
  - Session 176: +2 test files (test_fetchers.py — 30+ fetcher/registry tests, test_parsers.py — 40+ parser/metadata tests)
- **TOTAL: 5,525+ tests across all services (Phase 2A-2D coverage gaps filled)**
- **E2E Coverage:** 38 test files across all platforms — API (19), Web (12), Mobile (7)

### Phase 2 Coverage Gaps — Testing Strategy Progress
- **Phase 2A (API E2E):** ✅ COMPLETE — rate limiting 429 tests, file upload security edge cases
- **Phase 2B (Python Services):** ✅ COMPLETE — RAG/OCR router tests, embedding correctness, worker fetcher/parser tests
- **Phase 2C (Web Components):** ✅ COMPLETE — feed (8 components + 5 hooks), analytics (4 components + 1 hook), exports (2 components + 1 hook), error page
- **Phase 2D (Mobile Tests):** ✅ COMPLETE — MMKV storage, API client auth/token refresh, navigation guards (root + 3 group layouts)

### Phase 3 Integration Tests — Service Boundaries ✅ COMPLETE (Session 178)
- **billing-gate-enforcement.e2e-spec.ts** — 14 tests: tier blocking, upgrade/downgrade, entitlement resolution (bonus/admin/unlimited), Redis cache (2-min TTL, invalidation), cross-module enforcement, expired/revoked overrides
- **ingestion-pipeline.e2e-spec.ts** — 15 tests: full pipeline (ClamAV -> Quality -> OCR -> Classify -> Citations -> DB -> Search), service call ordering, malware quarantine, quality thresholds (reject <0.2, warn <0.4), OCR/classification/citation failure handling, PDF processing, search indexing (non-blocking), privacy defaults
- **search-rag-answer.e2e-spec.ts** — 12 tests: hybrid search (BM25+kNN RRF fusion), BM25 fallback, kNN failure fallback, Redis cache (5-min TTL), AI answer generation + audit (model_run records), abstention handling, RAG service errors (500, ECONNREFUSED), quota enforcement
- **camera-scan-digest.e2e-spec.ts** — 10 tests: upload digest generation (OCR -> RAG -> Digest), document digest with provenance records, confidence threshold (>=0.7 pending_review, <0.7 needs_human_review), model_run audit, RAG errors, empty OCR text, privacy controls (always private)
- **error-propagation.e2e-spec.ts** — 10 tests: RAG 400/500/ECONNREFUSED errors, no stack trace leaks, no internal URL leaks, OCR/S3/ClamAV processor failures, digest processor errors, OpenSearch unavailability, input validation (400 for invalid/empty/unknown fields)
- **Shared helpers:** mock-services.ts (factories for OCR, RAG, ClamAV, embedding responses), job-factory.ts (BullMQ mock job creation)
- **Total: ~61 new integration tests**

### Phase 4 Security Testing ✅ COMPLETE (Session 179)
- **jwt-security.e2e-spec.ts** — ~18 tests: tampered JWT rejection, wrong-key rejection, malformed/empty bearer, refresh token rotation, reuse detection (family revocation), device fingerprint binding, logout session revocation, error response safety (no secret leaks, no stack traces, no user enumeration), password reset token validation
- **sql-injection.e2e-spec.ts** — ~20 tests: SQL payloads in auth registration (email/name), OpenSearch query injection, SQL in search filters, bookmark notes, feed post content (including UNION SELECT), workspace matters/tasks/notes, path traversal in URL params, null byte injection, JSON/prototype pollution, no 500 errors from any payload
- **xss-security.e2e-spec.ts** — ~22 tests: stored XSS in feed posts (15 payload variants), feed comments, workspace matters (title/description), task comments, notes (title, Tiptap JSON body, link attrs with javascript: URI), user profile fullName, bookmarks, reflected XSS in search, security headers (X-Content-Type-Options, JSON content-type), error response XSS reflection
- **auth-security.e2e-spec.ts** — ~20 tests: privilege escalation (role/isAdmin override, orgId tampering), IDOR (cross-tenant matter/note/matter read/update/delete), mass assignment prevention (unknown fields in login/refresh/matter DTOs), sensitive data exposure (no passwordHash/mfaSecret/tokenHash in responses, no Prisma/SQL in errors), input validation bypass (100K chars, null bytes, type coercion, array injection), HTTP method enforcement, content-type enforcement, cross-tenant feed isolation
- **prompt-injection.e2e-spec.ts** — ~18 tests: 12 injection payloads (system prompt extraction, instruction override, delimiter escape, data exfiltration, role confusion), query validation (min/max length, empty, missing, non-string), boundary marker escape prevention, response safety (no internal URLs, no model config), quota enforcement, audit trail, RAG error handling (no stack trace leaks), digest generation injection
- **Total: ~98 new security tests across 5 test files**

---

## Known Issues / Workarounds (Non-Blocking)

- **React 18/19 type conflict:** Mobile uses React 18, Web uses React 19. Workaround: `typescript.ignoreBuildErrors: true` in next.config.ts; type checking done separately via `tsc --noEmit` in CI.
- **OneDrive path casing:** Windows OneDrive resolves paths as both `OneDrive` and `onedrive`. Workaround: `force-dynamic` root layout + custom `_document.tsx`/`_error.tsx`. Cosmetic webpack warnings remain.
- **Expo native dependencies:** Mobile app structure is complete; platform-specific native setup (Xcode/Android Studio) deferred until device testing phase.
- ~~**app-sidebar.test.tsx:** Fixed in Session 153.~~
- ~~**test_citation_tasks.py:** Fixed in Session 153.~~
