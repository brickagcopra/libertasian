# LIBERTASIAN — Pending Tasks

> Last updated: 2026-07-26 (search Phases A–C3 all merged: #306 #307 #308 #310 #311 #312; C3 squashed to `025e538`, deployed and live-verified on prod. Remaining search work is a client UI for `scope` and C4 fusion behind the reranker — but see the reachability note first: only 13,017 of 99,994 derivatives match any visibility branch.)

Verification rules used for this prune: every PR reference checked with `gh pr view <n> --json state,mergedAt`; every branch reference checked against `git branch -r --no-merged origin/main` after `git fetch --prune`. Items that could not be verified were MOVED to "Needs verification", not deleted.

---

## Owner / billing (genuinely open)

- [x] **Deploy api with #301** — DONE: api deployed + couponed checkout verified in prod 2026-07-15
- [ ] **Xendit go-live key swap** — deactivate the TEST plan FIRST, then swap env to live keys
- [ ] **2026-08-10: verify the first anchor-date recurring charge** collects correctly (first cycle after the anchor-date fix)
- [ ] **Annual interval check** — run one YEAR-interval checkout in sandbox; Xendit sessions doc lists interval DAY|WEEK|MONTH — if `YEAR` 400s, switch annual to `MONTH` × `interval_count: 12`
- [ ] **Activate Cards** as a payment channel
- [ ] **Edu-plan billing launch** — blocked on Xendit sandbox setup
- [ ] Xendit webhook end-to-end test with test payment methods; confirm Nginx webhook route in prod (Session 191 leftover)

## Mobile (next EAS build / store readiness)

- [ ] **Next EAS build / OTA must carry** (all JS-only): #289 annotations + highlights, #290 bookmark upgrade-alert copy, #297 anchor-offset fix + multi-annotation view sheet, #302 coupon input + Home search entry + Digests repair + Digests TabBar — no server deploy moves these. #302's api dependency is satisfied: the #301 api deploy went live 2026-07-15, so the Digests list params no longer 400
- [ ] **brick: device smoke of TestFlight build 8** — Google + Apple sign-in end-to-end (new user → onboarding, existing → tabs), cancel silent on both, Apple button absent on Android
- [ ] **Play Store first upload (manual)** — Android .aab from EAS build `4d20323a` (versionCode 3) + store metadata + reviewer account before App Review; service-account submit path stays unused until the first manual upload
- [ ] Store assets: replace placeholder `assets/icon.png` / `adaptive-icon.png` / `splash-icon.png` with branded assets; add `google-services.json` for Play submission
- [ ] iOS spot-check of #285 stack headers — chevron style (`chevron-back` fallback) + swipe-back within groups on simulator/TestFlight
- [ ] Mobile visual QA batch (#281/#284 rollouts): theme A (orange accent) ambient + owl contrast, reduce-motion → blobs AND owl static, DocumentReaderScreen ambient beneath zIndex 5 gradient + zIndex 10 header; native #285 headers are static Theme A cream — check acceptability under Theme B

## Web visual QA (post-deploy eyeball batch — #280/#282/#283 merged, no tooling)

- [ ] Home header owl position (moved right:5% → left:34%, tuned at 1440px) at common widths; dashboard h-14 `bar` variant live (only verified on an isolated preview page); glass ambient plainly visible on `/`, `/login`, dashboard; reduce-motion → everything static; owl still static on hero/signup illustrations
- [ ] Receipt email (#277 merged + deployed): send a sandbox receipt and eyeball in Gmail (web + mobile app) and at least one Outlook client — table layout, dark header band, PAID pill, button

## Staging re-enable prerequisites (#295 made deploys dispatch-only)

- [ ] Provision staging VPS (Docker + Compose, repo at `/opt/libertasian`, `DATABASE_URL` in host env)
- [ ] Set `STAGING_HOST` / `STAGING_USER` / `STAGING_SSH_KEY` (+ optional `STAGING_SSH_PORT`) on the GitHub `staging` environment (currently has ZERO secrets)
- [ ] Author the missing `docker-compose.staging.yml` the deploy script references (absent from repo — latent blocker)
- [ ] Then restore the `push: branches: [main]` trigger in `.github/workflows/deploy-staging.yml` (original trigger preserved in a comment)

## Search overhaul (Phases A–C3 merged, deployed and live-verified; client UI + C4 remain)

Ground truth below is from brick's Phase A production dry-run (2026-07-25) — measured on prod, not assumed.

**Shipped / verified**
- [x] Phase A (#306, `7166214`) — explicit mappings behind versioned aliases. Prod run: 17,135 docs → 85,977 entries in 3m24s. Filters confirmed live on `_v2`: `document_type=decision` 76,484 · `ponente=LOPEZ` 301 · `status=published` 29,166 · `gr_no_digits=246999` 4 · `ponente.text` match `hernando` 622 · `estafa` no-fuzzy 1,987 (was 4,040). Vector index repaired: `knn_vector` dim 384 HNSW, `index.knn` true, all 12,196 embeddings copied. Synonym rules parse against a real cluster — that risk is closed.
- [x] Phase B (#307, squashed to `27538fd`) — query intent classification + tiered ranking.

- [x] Phase C0 (#308, `b2d1da1`) — measured index-copy verification + `court_key` filter field.
- [x] Phase C1 (#310, `3e06e64`) — pure `extractSearchableText` for all 11 `content_json` shapes + the `dynamic: 'strict'` derivatives mapping (BM25 only, no `knn_vector`, no field able to hold an MCQ answer key). The 11 shapes moved to `@libertasian/types`; web vitest now aliases that package to source.
- [x] Phase C2 (#311, `d4077df`) — derivatives phase in the rebuild job (keyset, soft-delete-excluded, `_bulk` 500, per-item failures THROW) + `buildDerivativeVisibilityFilter` with `organization_id` **omitted** (never `''`) for null-org rows.
- [x] Phase C3 (#312, squashed to `025e538`) — federated `POST /search` with `scope=documents|derivatives|all`; visibility filter is a required non-optional argument; derivative results uncached (org-dependent key); kinds concatenated, not globally ranked; highlight fields named explicitly + `sanitizeDerivativeSource`; derivative-arm failure degrades to document results + warning; `describeTopology` `_r<N>` false-mismatch fixed.
- [x] **Phase C3 deployed and live-verified on prod (2026-07-26)** — api rebuilt and recreated from `025e538`; all four scope cases exercised against `POST /api/v1/search` with a minted RS256 JWT. Numbers in COMPLETED_TASKS.md Session 208.
- [x] **Both prod index rebuilds verified (2026-07-26)** — job 3, four indices: docs 17,135/17,135 → 85,977 sections, `vectorsCopied: 12196`, uploads 2, derivatives 99,994/99,994, `aliasSwapped: true`, `aliasesSkipped: []`, `court_key=supreme_court` exactly 7,443.

**What is actually reachable — read this before scoping Phase D**

Deploying the federated surface did **not** make ~100k derivatives reachable. Only the **13,017** `public_editorial` rows match a visibility branch. The other **86,977** are `visibility='private'` with `organization_id` NULL, so they match **neither** branch of `buildDerivativeVisibilityFilter` — not the public branch (wrong visibility) and not the org branch (no org to own them). They are indexed and invisible to every caller, which is the filter working as designed, not a bug to fix.

- [ ] **Question for brick: are those 86,977 private null-org rows a generation-pipeline gap or intended drafts?** This is a product decision, not an engineering task. If the generator was supposed to mark them `public_editorial` on approval, that is a pipeline defect and search recall is ~13% of what anyone assumes. If they are deliberate drafts, the corpus is correct and only the expectation needs fixing. Nothing downstream should be scoped until this is answered.

**Phase C — remaining**
- [ ] **No client sends `scope`** — web and mobile search UIs still query documents only. Federated results need a UI decision (separate "Study materials" section vs a filter chip) before they reach users. Kind labels and counts are already in the response `meta`.
- [ ] **`limit` is per corpus, not per response.** `federatedSearch` applies it to each arm, so `scope=all&limit=10` returns **20** items — 10 documents then 10 derivatives. Intentional: two concatenated BM25 lists cannot share one limit without one corpus silently starving the other. Phase D UI must render two sections from `meta.counts` and must **not** assume `items.length <= limit` — a client that slices to `limit` would drop the entire derivative section.
- [ ] **`content_plain_text` is still dead weight.** It is written from the create/update DTO and `null` in every generation path; C1's extractor is used only by the indexer. Persist the extraction on write, then backfill — real backfill size is **13,017 rows** (`public_editorial` + `approved`), not 99,994.
- [ ] **E2E cross-tenant tests must seed synthetic org-scoped rows.** `organization_id` is NULL on 100% of prod derivative rows, so no production data exercises the org branch. C2/C3 unit specs evaluate the DSL against synthetic documents; a real seeded E2E pass is still owed.
- [ ] **C4 — cross-corpus fusion.** The two result lists are concatenated because BM25 scores from indices with different mappings and term statistics are not comparable. Globally ranking them needs a reranker over the merged set → blocked on the same `RAG_RERANKER_URL` deployment as the kNN/cross-encoder work below.
- [ ] Digests + `bar_exam_questions` federation: scope unchanged from the original plan, not started.

## Parked PRs (decide: revive or close — all verified OPEN 2026-07-13; nothing closed)

- [ ] #2 chore(ingestion): align seed defaults with Option A tiered schedule
- [ ] #39 chore(infra): document Brevo as SMTP provider
- [ ] #99 feat(admin): pipeline-ops trigger page + digests list with status tabs
- [ ] #117 feat(mobile): design system Phase 1 — two-theme tokens, 14 primitives, 9 screen components
- [ ] #236 chore(api): Polly voice-spike script

## Planned work (not started)

- [ ] **Session 203 — Mobile Design System Phase 2**: wire the 9 presentational screens into real routes (onboarding, login, signup, home, library, reader, digest detail, search-as-own-tab, profile). TabBar IA decision pending — **question for brick:** 7 existing tabs vs design's 4 (Read/Library/Search/Me): drawer items or deep-link-only for the other 5? Open design questions: drop-cap approach on Android, expo-blur for reader top buttons. Phase 3+: BottomSheet primitive (gesture-handler recipe in memory), dark-mode variants, real images. Verification: EAS preview APK + max 2 visual iteration rounds. (Foundations shipped as PR #117 — parked above.)

## Backlog (genuine follow-ups, no deadline)

- [ ] Adopt `emailLayout()` shell in the other 11 notification templates (verify-email, reset-password, password-changed, member-invite, subscription-confirmation, subscription-cancelled, payment-failed, renewal-reminder, budget-alert, announcement, blog-notification) — #277 follow-up
- [ ] Resend-verification rate limiting (max 3 / 15 min per email, Redis) — currently global throttle only; backfill `EmailPreference` rows for existing users (Session 186)
- [ ] Spec-file TS error cleanup (Session 184): coupon (~539), promotion (~384), promotion-rule-engine (~209), research-workspaces (~152), pleadings (~129), ~35 other spec files (~987)
- [ ] Mobile `tsc --noEmit` React 19 @types cleanup (37 errors on main: Stack/Tabs/LinearGradient/Svg)
- [ ] Congress.gov.ph Cloudflare Turnstile: pick approach — (a) Playwright/headless, (b) ingest RAs via Official Gazette, (c) direct `docs.congress.hrep.online/legisdocs/ra_{congress}/RA{number}.pdf` URLs (Session 193)
- [ ] Enhancement wishlist (Sessions 200/202, deduped): document browser view toggle + sort options; search cards aware of existing digests ("View" vs "Generate"); stale-data indicator on digest detail; digest list infinite scroll; verify `@react-native-picker/picker` installed for classification override; admin derivatives real-time job status; study stats weekly sparkline; `codal_section` resource navigation; MCQ keyboard navigation; offline syllabus cache (SQLite)

## Needs verification (could NOT be verified against ground truth today — do not treat as done, do not treat as fact)

- [ ] #286 `apple_id` migration (`20260711120000_add_user_apple_id`): has `prisma migrate deploy` run in prod/staging? Also: local dev DB drift (applied migration `20260505013309` missing from directory) — reset vs reconcile still undecided
- [ ] #254 (2026-07-02): staging/dev `prisma migrate deploy` for the allowlist migration + RBAC Redis cache flush where warm; #250–#253 live verifications (admin sidebar/settings gating on prod; #250's revocation itself WAS live-verified 2026-07-02)
- [ ] #276 checkout-flow device QA (bounce → deep-link return, AppState safety net, both themes) — may have been implicitly covered by later live billing verification
- [ ] Session 193 ingestion: worker-service image rebuilt since the autodiscover fix? prod source endpoint URLs re-seeded (`seed-sources.ts`)? fetchers spot-tested?
- [ ] Sessions 185/186 Prisma migrations applied in prod (`add_email_preferences`, site-content)? end-to-end tests of verify-email OTP / preferences / announcements / homepage CMS
- [ ] Session 191: lifecycle processor e2e (create event with past `scheduledAt`, verify cron transitions)

## Blocked — requires external resources (unchanged)

| Item | Blocker |
|---|---|
| Embedding service kNN + cross-encoder reranker | Deploy models + set `RAG_EMBEDDING_SERVICE_URL` / `RAG_RERANKER_URL` (BM25-only + RRF fallback active) |
| Production VPS deployment | VPS provisioning (compose/nginx/monitoring/backup/GH Actions all ready) |
| OpenSearch index creation | Running OpenSearch instance (auto-creates on module init) |
| Qdrant migration / multi-region / white-label | Scale, budget, enterprise demand (Phase 5+) |

Deferred PRD decisions (Section 16): bilingual/Taglish queries (P2), on-device OCR preview, public API marketplace, AI pleading templates (legal risk).

## Known issues / workarounds (non-blocking)

- React 18/19 type conflict (mobile 18 / web 19): `typescript.ignoreBuildErrors` in next.config.ts; tsc runs separately in CI
- OneDrive path casing on Windows: `force-dynamic` root layout workaround; cosmetic webpack warnings remain
- Local gradle debug builds: expo-av CMake fails on arm64 (`build.ninja still dirty`); use `-PreactNativeArchitectures=x86_64` for emulator builds
