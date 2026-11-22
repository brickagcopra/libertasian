# Completed Tasks

## 2026-11-22 — Device limits phase 2a: concurrent-use cap (branch feature/device-limits-phase-2-concurrency, NOT committed/pushed)
- [x] API `SessionConcurrencyService` (modules/auth/session-concurrency, @Global module): per-user Redis zset `nest:session:active:{userId}` (sid -> last request ms) + `nest:session:displaced:{userId}` set, one atomic Lua script per request. Newest K by last request keep the slot; the one pushed out is marked displaced (sticky, no silent ping-pong); sessions idle > window just drop out unmarked. Pro 2 / Edu 1 / others uncapped; platform admins and tokens without `sid` exempt. Plan code cached `nest:session:tier:{orgId}` 300s. Fails open. Env: DEVICE_CONCURRENCY_ENABLED (default false), DEVICE_CONCURRENCY_PRO=2, DEVICE_CONCURRENCY_EDU=1, DEVICE_CONCURRENCY_WINDOW_SEC=600.
- [x] `JwtAuthGuard.canActivate` runs the check after passport auth (optional deps, so bare `new JwtAuthGuard()` still works) -> 409 `{ code: 'session_displaced' }`. `@AllowDisplacedSession()` on logout, GET/DELETE sessions, new `POST /auth/sessions/claim` (audit `auth.session_claimed`). Logout / revoke one / revoke all release the Redis slots.
- [x] Web: `lib/session-displaced.ts` store, api-client (fetch + upload) and AI-answer / deep-research streams raise it; `SessionDisplacedDialog` (root layout): "Use it here" -> claim + invalidate queries, "Sign out"; queries no longer retry 409.
- [x] Mobile: `features/session-displaced` (external store + `SessionDisplacedHost` modal in root layout), api-client + AI-answer stream raise it, queries no longer retry 409.
- [x] Tests: API session-concurrency (8 mocked + 6 real-Lua against a throwaway redis:7, opt-in via SESSION_CONCURRENCY_REDIS_URL), guard 6, controller +2; auth+common 525 pass, tsc clean. Web 385 pass (incl. 6 new), no new tsc errors (376 pre-existing), eslint clean. Mobile full suite 2221 pass after fixing 2 regressions (copy said "plan", which the App Review no-purchase-copy test forbids outside the purchase surface — now "Your account can be used on a limited number of devices"; _layout.test mocks the host), tsc clean.

## 2026-11-21 — Android purchases: RevenueCat, build, prod flag, analytics 400s
- [x] RevenueCat: imported the 4 Play subs (`<id>:<basePlan>`), attached pro.* to entitlement `pro` and edu.* to `edu`, mapped all 4 into the default (current) offering packages. Verified: the public API with the goog_ key returns all 4 packages with plan ids.
- [x] eas.json production env: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` added (branch `chore/android-revenuecat-key` @ 6e0d2fd4, pushed: NO, PR: NO).
- [x] Android 1.0.3 vC19 built (EAS 4534bd63) and live on the Play INTERNAL track (submission 31a9b8d8). AAB verified: key in bundle, billing client + BILLING permission present.
- [x] Prod `.env`: `STORE_PURCHASE_AVAILABLE_ANDROID=true` (was unset, so false and Android had no Plans entry). Backup `.env.bak-20261121-android-store`.
- [x] Android purchase VERIFIED on device (vC19, user bought a plan). Earlier `sdk_failed` was the phone still on alpha vC18 (no key).
- [x] Post-purchase screen: confirmed purchase/restore now shows "You're all set" + Done instead of plans + Continue (PR #550, 94e1ecaf). Android key PR #551 (628a0d7c) merged.
- [x] Android 1.0.3 vC20 (EAS 984eefee, from main @ 94e1ecaf) live on the INTERNAL track (Nov 21 9:35 PM).
- [x] iOS 1.0.3 approved and auto-released: live on the App Store (PH + US) since 2026-11-21 22:52 UTC.
- [x] In-app "Manage or cancel subscription" (PR #552, a4998217): subscribers see "Your subscription is active" instead of plans/Continue (also prevents a 2nd Play subscription); iOS uses Apple's sheet, Android opens the Play page via lib/store-account-page.ts (https store hosts only). Android vC21 (EAS c1d4eaf6) ACTIVE on internal track.
- [x] Repeated Google Play receipts explained: license-tester renewals (annual = every 30 min, max 6), all "Test:" orders, no money moved.
- [x] Analytics 400s: the 4 purchase telemetry events were missing from the API taxonomy; the mobile client also replayed refused events in /events/batch forever. PR #549 merged (69e9b815), API DEPLOYED and healthy. Mobile half (drop permanently refused events) ships with the next build.

## 2026-11-21 — Moderation: old reports worked + appeals, report cap, bulk actions
- [x] Prod queue cleared: the 4 Aug-15/16 `misinformation` reports (2 posts, both accurate RA 9165 / People v. Doria commentary, filed by QA accounts, 3 since deleted) DISMISSED via ModerationService in the api container as the platform moderator; `moderation_actions` + `audit_logs` rows written. 0 open reports/flags.
- [x] Author appeals: `moderation_appeals` (one per decision, 30-day window, only while in effect). User API `GET /community/standing/decisions`, `POST /community/standing/decisions/:id/appeal`; admin `GET /admin/moderation/appeals`, `POST /admin/moderation/appeals/:id/decide` (grant restores content / lifts sanction). Stats + daily email include open appeals. Notices say how to appeal and deep-link (`entityType: community_standing`).
- [x] Daily report cap: 20 reports per user per rolling 24h across posts, comments and community flags → 429 `quota_exceeded` + retryAfterSeconds. New (reporter_user_id, created_at) indexes.
- [x] Bulk actions: `POST /admin/moderation/cases/bulk-resolve` (≤50, per-case results); web queue checkboxes + bulk toolbar + dialog; Appeals tab with open count.
- [x] Mobile: Settings › Community standing (decisions, appeal form, outcomes).
- [x] Tests: API 5560/5560; web moderation+admin 160/160; mobile settings/notifications pass. Migration verified on a throwaway DB.
- [x] Merged PR #546 (f4ff5588) and DEPLOYED: prod migration `20261122120000_add_moderation_appeals_and_report_indexes` applied, api+web rebuilt and healthy, new routes live (401 without auth).
- [x] iOS 1.0.3 build 36 started on EAS (9c2c1d0e) from f4ff5588, 2026-11-21.
- [x] Build 36 submitted to TestFlight (EAS submission 225935c2-5e44-42eb-a53c-9e7c3dd19fb8, FINISHED).
- [x] Expo SDK 58 upgrade coded + tested (PR #547): RN 0.88, React 19.3, expo-av -> expo-audio, MMKV 4, google-signin 17, splash plugin, Xcode 27.2 image.
- [x] PR #547 squash-merged (d29999fb). iOS 1.0.3 (38) uploaded to TestFlight and SUBMITTED FOR REVIEW in ASC (draft swapped from build 34 to 38), 2026-11-21.
- [x] Android 1.0.3 vC18 (SDK 58) submitted to Play alpha track (EAS submission 202c9c8d-2316-46ac-97fb-15d567e0d3f9, FINISHED).
- [x] Google Play production access GRANTED for com.libertasian.app (2026-11-21).
- [x] eas.json Android submit track alpha -> production.
- [x] Play base-plan product id support (mobile + API + RevenueCat pull): PR #548 merged (3c5be6f0), API DEPLOYED to prod 2026-11-21 (healthy, verified in container). Mobile half ships with the next build.

## 2026-11-20 — Moderation queue (branch feature/moderation-queue)
- [x] Researched Discourse / Reddit / Mastodon / Discord / YouTube moderation + Apple 1.2: cases grouped per target, oldest-first with 24h SLA, content + author actions, auto-hide, append-only log.
- [x] API `modules/moderation`: cases/stats/detail, resolve (dismiss|remove, resolves all open reports in one tx), restore, sanctions (warning/suspension/ban, ban can remove all content), revoke, log. Tables `moderation_actions`, `community_sanctions`. Moderators can't act on their own content.
- [x] Enforcement: suspended/banned users can't post, comment, review or publish study items; a moderator-removed study item can't be re-published by its author.
- [x] SECURITY: `community:moderate` was on the system owner role (73 prod owners) → any signup could list all reports and remove any post. Now platform-scoped; feed/community admin controllers use PlatformPermissionsGuard.
- [x] Web: `/admin/moderation` queue + case detail, sidebar entry, dashboard tile. API 5549/5549, web moderation/admin 270/270.

## 2026-11-20 — App Review compliance shipped (PR #544, 8a8d042b)
- [x] Terms (mobile + web §7.1): zero-tolerance clause. App: one-time Community Guidelines agreement before the first post/comment (`features/community-guidelines`).
- [x] API `common/utils/content-filter.ts`: blocks slurs, profanity and sexual vulgarity (EN+FIL) on post/comment create+update and community reviews; legal vocabulary allowed (spec).
- [x] Comment reports: `feed_comment_reports` + `POST /feed/comments/:id/report` + admin list/resolve; app comment options sheet (report + block); community items reportable via FlagModal.
- [x] Deployed: prod migration applied, api+web rebuilt, /privacy and /terms show the new sections, health 200.
- [x] iOS 1.0.3 build 35 started on EAS.

## 2026-11-20 — AI-data disclosure fixes (branch feat/mobile-ai-data-consent)
- [x] Traced every OpenAI path: only rag-service `core/generation.py` calls OpenAI; embeddings (sentence-transformers), TTS (Kokoro), OCR and Help chat (local KB) don't. The mobile gate covers every NestJS route that reaches it; research-workspaces is not used on mobile. No name/email in any RAG request body.
- [x] Web privacy policy: new 2.4 Third-Party AI Processing (OpenAI) + OpenAI in 7. Data Sharing; Last updated -> 2026-11-20.
- [x] Consent sheet lists case comparisons (gated but unlisted). Settings gains Privacy Policy + Terms of Use rows.

## 2026-11-20 — Store status check + Play re-application
- [x] Play: the dashboard showed all 3 closed-test criteria met; re-applied for production with refreshed answers (removed the unverified "90,000+ decisions" claim; added the new page-4 "what did you do differently" answer). Console now reads "We have your application for production access".
- [x] Apple: LIBERTASIAN iOS 1.0.2 "Ready for Distribution". The App Compliance "New" badge = China-mainland items only (see pending).
- [x] Apple: removed China mainland from App Availability (now 95 regions; status "Processing to Not Available").

## TLS cert expiry alert (2026-11-16, PR #539)
- [x] Root cause: certbot renewed fine on 2026-11-04 (standalone + pre/post hooks stop/start nginx), but nginx serves COPIES in infrastructure/nginx/ssl/ and nothing copied the new cert (same cause as the 2026-10-04..06 outage).
- [x] Prod: copied cert4 into the ssl dir and reloaded nginx. All three hostnames now serve notAfter 2027-02-02; health 200.
- [x] PR #539: `infrastructure/scripts/certbot-deploy-hook.sh` (copy + nginx reload), guide §3.3–3.4 corrected; installed into /etc/letsencrypt/renewal-hooks/deploy/ on prod.

## 2026-09-30 — Deep Research device-test builds
- [x] Android 1.0.2 / vC15 (build 044d787d) → Play internal track; console reads "Available to internal testers" (Libertasian Testers, 27). Alpha/production untouched.
- [x] iOS 1.0.2 / 33 rejected by ASC (1.0.2 train closed after App Store approval, 90062/90186) → bumped to 1.0.3 (#534) → iOS 1.0.3 / 34 (build d675b3f8) uploaded to TestFlight (submission 51890f68 FINISHED). Not submitted for review.
- [x] ASC TestFlight verified: upload 1.0.3 (34) Complete; build 34 "Ready to Submit" in internal group Team (Expo).

## 2026-09-29 — Section chunks for search (2 PRs opened, not merged)
- [x] PR1 #528 fix(rag): hybrid fusion keeps only the best-ranked hit per (document_id, section_id) before top_k; document rows keyed by their own id
- [x] PR2 feat(api): `chunkSection` (>1,800 chars → ~1,500-char chunks, ~150 overlap, sentence-snapped ±200); chunk rows `{sectionId}:c{n}` in keyword (live + rebuild) and vector (full chunk as snippet); stale-row sweeps; backfill `pruneStale`; `EMBEDDING_BACKFILL_URL` + `embedding-backfill` compose service; opensearch 6G / 2g heap

## 2026-09-28 — Deep Research quote matching (PR opened, not merged)
- [x] `filter_citations` matches quotes via `match_quote`: casefold, collapsed whitespace, no space before `, . ; : )`, unified curly quotes/dashes, trailing punctuation stripped; "..."/"…" and "`: (a)`" list-item joins split into fragments (3+ words each, in order, same passage). Delivers the PASSAGE span joined by " … ", never the writer's text. Paraphrases stay `quote_not_found`.
- [x] Over-long quotes truncated to `MAX_QUOTE_WORDS` (30 → 50) instead of dropped; <2 words still `quote_length`. Prompt version → `deep-research-v3`. Verifier/abstention unchanged.

## 2026-09-28 — Deep Research removal reasons (PR opened, not merged)
- [x] `verify_draft` counts why things were removed (bad_label / quote_not_found / quote_length per citation; no_citations_left / verifier_unsupported / verifier_no_verdict per claim), logs `kept= removed= reasons=` once per run, and emits `done.removalReasons`. Counting only.
- [x] `evals.run` records `removal_reasons` per result (null when absent)
- [x] Web Deep Research abstained card: own titles for `out_of_scope` and `ranking_unavailable`

## 2026-09-28 — Deep Research abstention fixes (PR opened, not merged)
- [x] fix(rag): Deep Research abstains `ranking_unavailable` when the cross-encoder did not run (any `reranker:*` marker), instead of abstaining on an RRF score
- [x] Planner labels scope (in_scope / non_ph_law / future_or_hypothetical / nonsense, strict JSON + Pydantic); anything but in_scope abstains `out_of_scope` before retrieval. Prompt version → `deep-research-v2`
- [x] `deep_research_max_candidates` 40 → 30; new `deep_research_rerank_timeout` (30 s) for Deep Research's one rerank; /answer keeps `reranker_timeout` 20 s
- [x] Web + mobile abstention copy for the two new reasons (clients map by string with a fallback; no enum change)

## 2026-09-27 — Statute corpus repair follow-ups (PRs opened, not merged)
- [x] #516 fix(api): the index-rebuild `_reindex` copy runs as a polled task (no client retry, deadline + cancel); vector backfill batch default 32
- [x] #517 feat(worker): `reseed_statutory_document`: re-parse in place keeping section ids, never delete, new version + audit per doc, `needs_decision` flag. Parser drops nested-block echo and collapses duplicate paragraphs.
- [x] #518 fix(api): a stale audio rendition (hash ≠ current text) is regenerated on play (202 pending), never served

## 2026-09-27 — Prompts 6–8 (PRs opened, not merged)
- [x] #511 fix(rag): statute-aware retrieval + BM25 stopword poisoning (45 new tests)
- [x] #512 fix(worker): `_parse_sections` off-by-one + `realign_statutory_sections` (dry-run default, audit log per doc, audio_renditions report)
- [x] #513 Deep Research client follow-ups: mobile reader pinpoint highlight + login/OAuth redirect keeps path+query (open-redirect safe)

## Security Hardening (2026-04-08)

### Section 1: Secure API Documentation & Python Services
- [x] 1.1 Disabled Swagger docs in production (NODE_ENV check in main.ts, nginx returns 404)
- [x] 1.2 Added internal API key auth to all Python services:
  - Created `shared/auth.py` with `verify_internal_key` dependency in RAG, OCR, Embedding services
  - Added `internal_api_key` to all three service configs
  - Added `Depends(verify_internal_key)` to ALL routers (12 RAG, 5 OCR, 1 Embedding)
  - Added X-Internal-Api-Key header to NestJS client services (ocr-client, ai-answers, embedding-client)
  - Added env vars to docker-compose.prod.yml
- [x] 1.3 Removed hardcoded credentials (minioadmin defaults, dev-internal-api-key)

### Section 2: Harden CSP, Security Headers, Fix XSS
- [x] 2.1 Removed 'unsafe-inline' from script-src, added font-src, base-uri, form-action
- [x] 2.2 Replaced weak ssl_ciphers with explicit modern cipher suite
- [x] 2.3 Changed camera=(self) to camera=() in Permissions-Policy
- [x] 2.4 Added DOMPurify sanitization to search-result-card.tsx and scans/search/page.tsx
- [x] 2.5 Added withSecurityHeaders helper to Next.js middleware.ts

### Section 3: Fix Dependency Vulnerabilities
- [x] Added pnpm.overrides for handlebars, tar, picomatch, node-forge
- [x] Updated nodemailer

### Section 4: Enforce Production Security in NestJS
- [x] 4.1 Added production RS256 requirement check in auth.service.ts
- [x] 4.2 Added @Throttle(60 req/min) to all 6 public document GET endpoints
- [x] 4.3 Added @Throttle(30 req/min) to search, citation, suggestions endpoints

### Section 5: Harden Python Services
- [x] 5.1 Added Image.MAX_IMAGE_PIXELS = 100_000_000 to scorer.py and enhance.py
- [x] 5.2 Added magic byte validation for uploaded images in OCR router
- [x] 5.3 Added ALLOWED_DOMAINS frozenset and _validate_url to base fetcher + all 4 concrete fetchers
- [x] 5.4 Changed query logging to log only query_length (no PII)

### Section 6: Docker Network Segmentation
- [x] Added 4 bridge networks: frontend, backend, ai, storage
- [x] Assigned each service to appropriate networks

### Verification
- [x] pnpm lint — pre-existing eslint PATH issue in @libertasian/types (not from changes)
- [x] pnpm --filter api test — 2434 passed, 30 pre-existing failures in analytics-aggregation
- [x] pnpm --filter web build — successful
- [x] ruff check on RAG, OCR, Worker — no new errors from changes (E402 fix committed)
- [x] mypy on RAG service — all errors pre-existing (missing stubs, generic types)

### Commits
1. `14a9503` security: protect Swagger docs, add internal auth to Python services, remove hardcoded credentials
2. `aeb6bd3` security: harden CSP and cipher suites, sanitize HTML rendering, add security headers
3. `8cbdf05` security: upgrade vulnerable dependencies
4. `f4f6b92` security: enforce RS256 in production, add rate limits to public endpoints
5. `6f2c869` security: harden OCR service, strengthen URL allowlisting, reduce PII logging
6. `1a0f9f7` security: add Docker network segmentation
7. `77a6026` fix: move PIL pixel limit after imports to fix E402 ruff errors

---

## OpenAI API Integration + Admin AI Settings Panel (2026-04-08)

### Part 1: Switch Generation Layer from vLLM to OpenAI API
- [x] 1.1 Added `openai>=1.60.0` to `services/rag-service/pyproject.toml`
- [x] 1.2 Updated `services/rag-service/src/config.py` with OpenAI settings (api_key, model, timeout) + vLLM fallback
- [x] 1.3 Rewrote `services/rag-service/src/core/generation.py`:
  - AsyncOpenAI client (lazy singleton) when `openai_api_key` is set
  - vLLM httpx fallback when no API key
  - Redis token usage tracking (HINCRBY `llm:usage:{YYYY-MM}`)
  - Budget enforcement via `llm:config:monthly_budget_usd` Redis key
  - MODEL_PRICING dict for cost estimation
  - Same public function signatures (`generate_completion` -> str, `stream_completion` -> AsyncIterator[str])
- [x] 1.3b Added `BudgetExceededError` to `services/rag-service/src/shared/exceptions.py`
  - Global FastAPI exception handler in `main.py` returns HTTP 503
  - Answer router re-raises before catching `RagPipelineError`
- [x] 1.4 Updated `.env.example` with `RAG_OPENAI_API_KEY`, `RAG_OPENAI_MODEL`, `RAG_OPENAI_REQUEST_TIMEOUT`

### Part 2: Admin AI Settings Panel
- [x] 2.1 Added `AiSettings` model to Prisma schema + User relation
- [x] 2.2 Created NestJS `AiSettingsModule` (service, controller, DTOs, model-runs endpoint)
- [x] 2.3 Created `ingestion-scheduler.service.ts` in sources module
- [x] 2.4 Created admin AI Settings web page with usage tracking and ingestion scheduling

### Part 3: Budget Alert Notifications
- [x] Created `budget-alert.ts` email template
- [x] Added `checkBudgetThresholds()` to AiSettingsService (75%, 90%, 100% thresholds)

### Part 4: Internal Model Runs Endpoint
- [x] Created `POST /api/v1/internal/model-runs` (InternalApiGuard, no JWT)
- [x] Records model run in `model_runs` table

- 2026-11-22: Android vC21 (1.0.3) verified by user on internal track; promoted to production (PH + US) and sent for Google review.

- 2026-11-22: Android vC21 (1.0.3) verified by user on internal track; promoted to production (PH + US) and sent for Google review.
- 2026-11-22: iOS 1.0.4 (build 39) built with post-purchase confirmation + manage/cancel subscription; version created in ASC, What's New set, submitted for App Review (auto-release on approval).
- 2026-11-22: PR #554 (subscription bought on other platform/web shows 'Your plan is active', no buy/manage) and PR #555 (device limits phase 1: Pro 3 / Edu 2, LRU eviction, X-Device-Id headers, ToS clause) merged; API+web deployed to prod with DEVICE_LIMITS_ENABLED=true. Competitor research: Jur.ph 3 devices; Digest PH/Anycase/CD Asia no published cap.
