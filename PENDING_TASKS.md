# LIBERTASIAN — Pending Tasks

> Last updated: 2026-07-02 (PR #253 — auth bootstrap stale-user fix awaiting merge + web rebuild)

---

## 2026-07-02 — PR #253 rollout (owner action required)

- [ ] Review + merge https://github.com/brickagcopra/libertasian/pull/253 (`fix/auth-bootstrap-stale-user`)
- [ ] Rebuild + redeploy the web app (agent did NOT deploy)
- [ ] Live verification: account whose platform-admin was revoked server-side loses the Admin sidebar/`/admin` access on next page load without re-login (persist v0→v1 migration drops the stale cached user, bootstrap refetch pulls the fresh profile)

---

## 2026-07-01 — PR #252 rollout (owner action required)

- [ ] Review + merge https://github.com/brickagcopra/libertasian/pull/252 (`fix/settings-admin-visibility`)
- [ ] Rebuild + redeploy the web app (agent did NOT deploy)
- [ ] Live verification: free/owner account sees only Settings + Usage & Quotas in the Settings section and is redirected to /search from `/settings/{members,roles,audit-logs,analytics}`; platform-admin allowlist accounts retain access

---

## 2026-07-01 — PR #251 rollout (owner action required)

- [ ] Review + merge https://github.com/brickagcopra/libertasian/pull/251 (`fix/sidebar-admin-visibility`)
- [ ] Rebuild + redeploy the web app (agent did NOT deploy)
- [ ] Live verification: free/owner account no longer sees the Admin sidebar section; platform-admin allowlist accounts still do

---

## 2026-07-01 — PR #250 rollout (owner action required)

- [ ] Review + merge https://github.com/brickagcopra/libertasian/pull/250 (`fix/owner-role-strip-platform-admin`)
- [ ] Prod `prisma migrate deploy` (agent did NOT touch prod — local dev DB only)
- [ ] **Flush the RBAC effective-permission Redis cache** after the prod migrate — stale cached permission sets keep resolving `isPlatformAdmin=true` until TTL
- [ ] Live verification: fresh signup gets 403 on `/admin/*`; the 4 allowlisted accounts retain admin access

---

## Session 203 — Mobile Design System Phase 2 (PLANNED, NOT YET STARTED)

Foundations are in place (tokens, ThemeProvider, fonts, 14 primitives, 9 presentational screens, dev gallery, theme switcher, all tests passing). Phase 2 plugs the new screens into real app routes without losing data integration.

**Wire-up tasks (one PR per route or batched per cluster):**
1. **Onboarding** — multi-step existing flow stays; restyle each step with the new visual language. The design's splash can become an optional Step 0 or first-launch screen.
2. **Login** (`(auth)/login.tsx`) — replace JSX with `<LoginScreen onSubmit={...} loading={...} error={...} />` while keeping the existing auth-provider call.
3. **Signup / Register** (`(auth)/register.tsx`) — multi-step register exists; design's chip-picker maps to one of the steps.
4. **Home** (`(tabs)/index.tsx`) — currently a 935-line search-first screen. The design's home is a feed/brief/streak. Decide: replace home content entirely, or move existing search-first logic into a new search tab. Design itself answers this — Search is its own tab in the design's TabBar.
5. **Library** (`documents/index.tsx`) — wire `useDocuments`, infinite scroll, filter chips, search hand-off into `<LibraryScreen ... />`.
6. **Document reader** (`reader/[id].tsx`) — keep existing tabbed layout (sections/citations/related) but use the design's TLDR card + serif body + FAB.
7. **Digest detail** (`digest/[id].tsx`) — wire to `useDigest(id)`; map facts/issues/ruling/doctrine to `DigestSection[]`; sticky CTA drives "View source document".
8. **Search** — needs a dedicated route, e.g. `(tabs)/search.tsx`. Move search logic out of `(tabs)/index.tsx` into its own route.
9. **Profile / Settings** (`settings/index.tsx`) — restyle with `<ProfileScreen identity plan rows />`. Hook `plan` to subscription, `rows` to existing settings actions.

**TabBar IA decision pending:**
- Existing `(tabs)/_layout.tsx` exposes 7 tabs; design has 4 (Read / Library / Search / Me).
- Plan: hide native tab bar, overlay design TabBar, route `Me` to `/settings`. Move the other 5 routes (digests/study/scan/feed/workspace) into a drawer or secondary menu.
- **Question for brick:** drop the extra tabs from the bar and surface them as drawer items, or keep them as deep-linkable routes only?

**Verification still pending:**
- EAS preview APK (brick triggers from dashboard or `eas build --profile preview --platform android`). Phase 1 locally verified: `tsc --noEmit` clean, 1339 tests passing.
- Cap of 2 iteration rounds on visual feedback after the first APK.

**Open design questions:**
- Drop-cap rendering on Android — RN's split-then-prepend approach used in `DigestDetailScreen` works but kerning is approximate. Acceptable for v1 or worth a `react-native-svg` drop-cap component?
- `expo-blur` for the article reader's translucent top buttons (currently semi-transparent white) — add real blur in Phase 2?

**Follow-up (Phase 3+):**
- BottomSheet primitive (deferred from CP4 due to gesture-handler boot regression). Memory `mobile_redesign_state.md` has the install recipe.
- Dark-mode variant of each theme (both currently light).
- Real images replacing the gradient `Photo` placeholders.

---

## Session 202 — Document Browser, Search Enhancements, Navigation Polish, Offline Indicators — ALL COMPLETE

No pending items. All 7 tasks completed (13 new tests, multiple existing tests updated).

**Follow-up items (future sessions):**
- Document browser could add column/list view toggle for different layouts
- Search results: track which documents already have digests (to show "View Digest" vs "Generate Digest" on cards)
- Stale data indicator on digest detail screen (show "last fetched X minutes ago" when from cache)
- Document browser: add sort options (newest, alphabetical, most cited)
- Digest filter bar could add infinite scroll / cursor-based pagination for digest list
- Classification override modal uses `@react-native-picker/picker` — verify it's installed (`npx expo install @react-native-picker/picker`)
- Admin derivatives: real-time job status polling/WebSocket for generation jobs
- Study stats: weekly chart/sparkline for sessions per day
- Consider adding `codal_section` resource navigation (from Session 200)
- MCQ section: keyboard navigation for accessibility
- Offline support for syllabus data (cache syllabi + progress in SQLite)

---

## Session 200 — Mobile Syllabus Screens — ALL COMPLETE

No pending items. All 9 tasks completed and verified (24 new tests passing, 51 total in matched suites).

**Follow-up items (future sessions):**
- Consider adding `codal_section` resource navigation (currently no-op since no `/study/codals/section/:id` route exists)
- MCQ section could support keyboard navigation for accessibility
- Offline support for syllabus data (cache syllabi + progress in SQLite)

---

## Session 199 — Fix 7 Pre-Existing E2E Failures — ALL COMPLETE

No pending items. All 7 target E2E failures fixed (test-only changes). 39/49 suites passing. 10 remaining failures are pre-existing from branch WIP (schema drift for `digests.model_run_id`, AuditService DI in derivative-artifact/mcq-question, content-disclaimers app.close(), and others).

---

## Session 198 — PR 6.1: Derivatives Admin Page — ALL COMPLETE

No pending items. All 6 tasks completed and verified (23 new tests passing, 133 existing tests passing, no regressions).

**Note:** `prisma generate` could not be run because the Prisma query engine DLL was locked by another process. The `deletedAt` field is correctly in the schema and `prisma format` succeeded. Once the DLL is unlocked (e.g., restart any running dev server), run `pnpm --filter api prisma:generate` to regenerate the client. The `tsc --noEmit` check shows zero errors from our new code — only pre-existing backfill TS errors remain.

---

## Session 197 — PR 5.3: Flashcard + Subject Outline — ALL COMPLETE

No pending items. All 7 tasks completed and verified (41 new tests passing, no regressions).

---

## Session 196 — PR 5.2: Essay Prompt + ALAC Model Answer — ALL COMPLETE

No pending items. All 6 tasks completed and verified (30 new tests passing, no regressions).

---

## Session 195 — PR 5.1: MCQ Derivative Type End-to-End — ALL COMPLETE

No pending items. All 9 tasks completed and verified (32 new tests passing, no regressions).

---

## Session 194 — PR 4.3: Doctrine Extract Type End-to-End — ALL COMPLETE

No pending items. All 8 tasks completed and verified (29 new tests passing, full suite green).

---

## Session 193 — Ingestion Pipeline Fix: Celery + Fetchers — ALL COMPLETE

### Post-deploy Steps
- **Rebuild worker-service Docker image** — The current container has the broken autodiscover. Push to main and rebuild.
- **Re-seed endpoint URLs on prod DB** — Run `npx ts-node apps/api/prisma/seed-sources.ts` to update the endpoint URLs in the database (old URLs are cached from the original seed).
- **Test each fetcher** locally with:
  ```bash
  cd services/worker-service
  python -c "from src.fetchers.supreme_court import SupremeCourtFetcher; f = SupremeCourtFetcher(); print(f.discover('https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/Jan/2025/1'))"
  ```
- **Congress.gov.ph Cloudflare limitation** — The Congress fetcher will return 0 candidates from `congress.gov.ph` due to Cloudflare Turnstile. Consider: (a) using Playwright/headless browser, or (b) ingesting Republic Acts via the Official Gazette instead, or (c) constructing PDF URLs directly from `docs.congress.hrep.online/legisdocs/ra_{congress}/RA{number}.pdf`.

---

## Session 192 — Mobile App EAS & Store Setup

### BLOCKER: ErrorOverlay crash in Expo Go
The app bundles successfully but crashes at runtime with `"Objects are not valid as a React child"` in `@expo/metro-runtime`'s `ErrorOverlay` component. This is a [known Expo SDK 52 bug](https://github.com/expo/expo/issues/33585).

**What we've tried (all failed):**
- Minimal root layout (`<Text>Hello</Text>`) — still crashes, confirming it's not our code
- `npx expo install --fix` — fixed 12 mismatched package versions, didn't resolve
- `--no-dev --clear` mode — ErrorOverlay still active in Expo Go
- ErrorBoundary + LogBox.ignoreAllLogs — error is above our component tree
- Metro `resolveRequest` shim to bypass `@expo/metro-runtime/error-overlay` — needs full cache clear to verify

**Root cause traced to:** `expo-router/build/renderRootComponent.js` line 77 wraps app with `withErrorOverlay()` from `@expo/metro-runtime/error-overlay`, which uses a buggy `ErrorToastContainer` component.

**Next steps to try:**
1. **Full cache nuke** — Kill ALL node processes, delete `node_modules/.cache`, `.expo/`, run `pnpm install` fresh, then `npx expo start --clear`. The metro shim (`metro.config.js` → `error-overlay-shim.js`) may not have been picked up due to stale cache
2. **Try development build** instead of Expo Go: `npx expo run:android` or `eas build --profile development --platform android`
3. **Try Expo SDK 53** — `npx expo install expo@latest` (if the bug is fixed in SDK 53)
4. **Patch `renderRootComponent.js` directly** — Remove the `withErrorOverlay` call as a last resort

### Before Store Submission (after ErrorOverlay fix)
- **Replace placeholder icons** — Replace `assets/icon.png`, `assets/adaptive-icon.png`, and `assets/splash-icon.png` with real LIBERTASIAN branded assets
- **Fill in Apple credentials** in `eas.json` submit section (`appleId`, `ascAppId`, `appleTeamId`)
- **Add `google-services.json`** for Android Play Store submission
- **Run first EAS build** — `eas build --platform all --profile development`

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
